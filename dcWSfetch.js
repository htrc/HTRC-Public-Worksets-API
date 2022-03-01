//url parser to
//serialize querystring parameter
//thenRequest is a library to make sync request call
//async is a library to call async request
//_ is an array, collection and text library
//jsonld library
//winston for logging
//Q for promises
//reading file system / file
//config library
import url from 'url';
import querystring from 'querystring';
import thenRequest from 'then-request';
import _ from 'underscore';
import jsonld from 'jsonld';
import Q from 'q';
import fs from "fs";
import config from 'config';
//logger
import { createLogger, format, transports } from 'winston';

//Setup logger
const myFormat = format.printf( ({ level, message, timestamp , ...metadata }) => {
	let msg = `${timestamp} [${level}] : ${message} `
	if(metadata) {
		msg += JSON.stringify(metadata)
	}
	return msg
});
const logger = createLogger({
	level: 'info',
	format: format.json()
});
if (process.env.NODE_ENV !== 'production') {
	logger.add(new transports.Console({
		level: 'debug',
		format: format.combine(
			format.colorize(),
			format.splat(),
			format.timestamp(),
			myFormat
		),
	}));
}

//load jsonConfig
var jsonConfig = {};

const loadconfig = logger.startTimer();
//load configuration
fs.readFile('./SPARQL/dcWSfetch/config-hashed.json', function(err,res) {
	jsonConfig = JSON.parse(res);
	//parse json Config, find any resource configuration url
	Object.keys(jsonConfig.services).forEach(function(keyConfig) {
		var configService = jsonConfig.services[keyConfig];
		Object.keys(configService).forEach(function(key) {
			var methodConfig = configService[key];
			//parse Sparql definition
			if (_.isObject(methodConfig)) {
				const getSparqlResource = logger.startTimer();
				if (methodConfig['query'] !== undefined) {
					fs.readFile('./SPARQL/dcWSfetch/' + methodConfig['query'], 'utf8', function(err,data) {
						methodConfig['resQuery'] = data;
					});
				}
				if (methodConfig['paging'] !== undefined) {
					fs.readFile('./SPARQL/dcWSfetch/' + methodConfig['paging']['query'], 'utf8', function(err,data) {
						methodConfig['resPaging'] = data;
					});
				}
				if (methodConfig['context'] !== undefined) {
					const getContextResource = logger.startTimer();
					fs.readFile(methodConfig['context'], function(err,data) {
						methodConfig['resContext'] = JSON.parse(data);
					});
					getContextResource.done({ message: "Finished loading context resource"});
				}
				getSparqlResource.done({ message: "Finished loading sparql resource"});
			}
		})
	})
	loadconfig.done({ message: "Finished loading config"});
})

//Used to load results where the number of triples is greater than the set limit
function tracePage(serviceConfig,pOffset,pLimit) {
	var tracePagePromise = Q.defer();
	var pageQuery = serviceConfig.resPaging;
	pOffset = pOffset + pLimit + 1;
	pageQuery = pageQuery + " OFFSET " + pOffset + " LIMIT " + pLimit;
	var sqlParser = new SqlParser(pageQuery, params, serviceConfig);
	sqlParser.replace();
	pageQuery = sqlParser.getRdfSql();
								
	var pagedSqlPoster = new PostCode(host, defaultGraphUrl, pageQuery, shouldSponge, format, timeout, debug);
	var pagedBody = pagedSqlPoster.postQuery();
	pagedBody.then(function(resPaged) {
		var jsonPaged = JSON.parse(resPaged.getBody('UTF-8'));
		if (jsonPaged["@graph"]!==undefined&&jsonPaged["@graph"][0][serviceConfig.paging.field] !== undefined) {
			var objectPaged = jsonPaged["@graph"][0][serviceConfig.paging.field];
			var nextPage = tracePage(serviceConfig,pOffset,pLimit);
			nextPage.then(function(resPage){						
				objectPaged.push.apply(objectPaged,resPage);
				tracePagePromise.resolve(objectPaged);
			});										
		} else {
			tracePagePromise.resolve([]);
		}
	},function(err){
		tracePagePromise.resolve([]);
	});
	return tracePagePromise.promise;
}

/*export function runSPARQLQuery(req,res) {
	// set content-type based on output parameter
	var serviceName = "dcWSfetch";
	var serviceMethod = req.params.serviceMethod;
	console.log("Does Service Method Load? -- %s", serviceMethod);
	//Define object for error return value
	var errorStatus = {
		errorcode: -1
	};
	var limit = jsonConfig.services[serviceName]['limit'];


	//Trap for unconfig servicename
	try {
		//Trap for unconfig servicemethod

		if (jsonConfig.services[serviceName][serviceMethod] == undefined) {
			throw Error("service method " + serviceMethod + " for " + serviceName + " is undefined");
		}


		var queryString = url.parse(req.url, true).query;

		var requiredParam = jsonConfig.services[serviceName][serviceMethod]["required"];
		var optionalParam = jsonConfig.services[serviceName][serviceMethod]["optional"];
		optionalParam.push("offset");
		optionalParam.push("limit");

//		format = "application/x-json+ld";
		var format = "application/ld+json"
		var output = "application/ld+json";
		var params = {};
		var serviceConfig = jsonConfig.services[serviceName][serviceMethod];
		//Parse url parameters , check if there is some parameters that is not allowed
		console.time("parseparam");
		Object.keys(queryString).forEach(function(key) {
			if (!_.contains(requiredParam, key) && !_.contains(optionalParam, key)) {
				throw Error("parameter " + key + " is not allowed");
			}
			var val = queryString[key];
			if (serviceConfig[key] !== undefined && serviceConfig[key]['type'] !== undefined) {
				switch (serviceConfig[key]['type']) {
					case "url":
						var urlRegex = /^(https?:\/\/(?:www\.|(?!www))[^\s\.]+\.[^\s]{2,}|www\.[^\s]+\.[^\s]{2,})\w$/;
						var result = val.match(urlRegex);
						val = '<'+val+'>';

						if (result === null) {
							throw Error("Parameter " + key + " must be a URL, example http://hathitrust.org/id/123");
						}
						break;
					case "number":*/
//						var numberRegex = /^[0-9]*/;
/*						var result = val.match(numberRegex);

						if (result === null) {
							throw Error("Parameter " + key + " must be a number");
						}
						break;
				}
			}
			//Change to params[key] only
			params[key] = val;
		});
		console.timeEnd("parseparam");

		//Set response / result header into requested format
		res.setHeader('content-type', output);

		var host = config.get('Read-Only_Endpoint.domain') + ':' + config.get('Read-Only_Endpoint.port');
		var defaultGraphUrl = "";
		var shouldSponge = "";
		var timeout = 0;
		var debug = "off";
		var query = "";

		var body = {};

		//get sparql query
		try {
			var result = {};
			var query = serviceConfig['resQuery'];

			//Get SPARQL Query as text
			if (serviceConfig.customized) {
				//Custom query function
				var customQuery = new CustomQuery();
				query = customQuery[serviceConfig['function']](serviceConfig, params, query);
			} else {
				//Parse the rdfSql first and inject parameters:query:
				var sqlParser = new SqlParser(query, params, serviceConfig);
				sqlParser.replace();
				query = sqlParser.getRdfSql();
			}

			var offset = 0;
			if (params['offset'] !== undefined) {
				offset = params['offset'];
				query = query + " OFFSET " + params['offset'];
			}
			if (params['limit'] !== undefined) {
				query = query + " LIMIT " + params['limit'];
			} else {
				query = query + " LIMIT " + limit;
			}

			var sqlPorter = new PostCode(host, defaultGraphUrl, query, shouldSponge, format, timeout, debug);
//			console.log("sqlPorter object: %o",sqlPorter);
			console.time("postQuery");
			body = sqlPorter.postQuery();
			body.then(function(resBody) {
				//parse result into jsonConfig
				console.timeEnd("postQuery");

				var jsonldBody = JSON.parse(resBody.getBody('UTF-8'));
//				console.log("JSON-LD body: %o",jsonldBody);
				var postPagingDefer = Q.defer();

				//Paging handler
				if (serviceConfig.paging !== undefined) {				
					if (jsonldBody["@graph"]!==undefined&&jsonldBody["@graph"][0][serviceConfig.paging.field].length === limit) {
						tracePage(serviceConfig,offset,limit).then(function(resPage) {
							jsonldBody["@graph"][0][serviceConfig.paging.field].push.apply(jsonldBody["@graph"][0][serviceConfig.paging.field],resPage);
							postPagingDefer.resolve(jsonldBody);
						})
					} else{
						postPagingDefer.resolve(jsonldBody);
					}
					
				} else{
					postPagingDefer.resolve(jsonldBody);
				}
				
				postPagingDefer.promise.then(function(resPage) {
					if (serviceConfig['context'] !== undefined) {
						//do flatten and compacting jsonld
//						console.log("Loaded context is %o",serviceConfig['context']);
//						console.log("Pre-compacted results: %o",resPage);
						fs.readFile(serviceConfig['context'],function(e,d){
							if (e) {
								console.log("Error: %o",e);
								throw e;
							}
							else {
								var context = JSON.parse(d);
								var promises = jsonld.promises;
								console.time("compactandcontext");
								var promise = promises.compact(resPage, context);
								promise.then(function(compacted) {
									console.timeEnd("compactandcontext");
									res.status(200).end(JSON.stringify(compacted));
									return;
								}, function(err) {
									throw err;
								});
							}
						});
					} else {
						res.status(200).end(JSON.stringify(resPage));
						return;
					}
				})
			})
		} catch (err) {
			errorStatus.message = err.message;
			res.end(JSON.stringify(errorStatus));
			return;
		}
	} catch (err) {
		errorStatus.message = err.message;
		res.end(JSON.stringify(errorStatus));
		return;
	}
}*/

export function runAPIRequest(req,res,serviceMethod) {
	var serviceName = "dcWSfetch";
	logger.info("Does Service Method Load? -- %s", serviceMethod);
	//Define object for error return value
	var errorStatus = {
		errorcode: -1
	};
	var limit = jsonConfig.services[serviceName]['limit'];
	if ('id' in req.params) {
		let splice_position = req.params.id.indexOf(':/') + 2;
		req.params.id = req.params.id.substring(0,splice_position) + '/' + req.params.id.substring(splice_position);
	}


	//Trap for unconfig servicename
	try {
		//Trap for unconfig servicemethod

		if (jsonConfig.services[serviceName][serviceMethod] == undefined) {
			throw Error("service method " + serviceMethod + " for " + serviceName + " is undefined");
		}


		var user_submitted_params = url.parse(req.url, true).query;
		user_submitted_params = Object.assign(user_submitted_params,req.params);
		logger.info("User submitted params: %o", user_submitted_params);

		var requiredParam = jsonConfig.services[serviceName][serviceMethod]["required"];
		var optionalParam = jsonConfig.services[serviceName][serviceMethod]["optional"];
		optionalParam.push("offset");
		optionalParam.push("limit");

//		format = "application/x-json+ld";
		var format = "application/ld+json"
		var output = "application/ld+json";
		var params = {};
		var serviceConfig = jsonConfig.services[serviceName][serviceMethod];
		//Parse url parameters , check if there is some parameters that is not allowed
		const parseparam = logger.startTimer();
		logger.info("Processing keys");
		Object.keys(user_submitted_params).forEach(function(key) {
			if (!_.contains(requiredParam, key) && !_.contains(optionalParam, key)) {
				logger.error("parameter %s is not allowed",key);
				throw Error("parameter " + key + " is not allowed");
			}
			var val = user_submitted_params[key];
			if (serviceConfig[key] !== undefined && serviceConfig[key]['type'] !== undefined) {
				switch (serviceConfig[key]['type']) {
					case "url":
						var urlRegex = /^(https?:\/\/(?:www\.|(?!www))[^\s\.]+\.[^\s]{2,}|www\.[^\s]+\.[^\s]{2,})\w$/;
						var result = val.match(urlRegex);
						val = '<'+val+'>';

						if (result === null) {
							logger.error("Parameter %s must be a URL, example http://hathitrust.org/id/123",key);
							throw Error("Parameter " + key + " must be a URL, example http://hathitrust.org/id/123");
						}
						break;
					case "number":
						var numberRegex = /^[0-9]*/;
						var result = val.match(numberRegex);

						if (result === null) {
							logger.error("Parameter %s must be a number",key);
							throw Error("Parameter " + key + " must be a number");
						}
						break;
				}
			}
			//Change to params[key] only
			params[key] = val;
		});
		parseparam.done({ message: "Finished processing keys"});

		//Set response / result header into requested format
		res.setHeader('content-type', output);

		var host = config.get('Read-Only_Endpoint.domain') + ':' + config.get('Read-Only_Endpoint.port');
		var defaultGraphUrl = "";
		var shouldSponge = "";
		var timeout = 0;
		var debug = "off";
		var query = "";

		var body = {};

		logger.info("About to enter the try statement");
		//get sparql query
		try {
			var result = {};
			var query = serviceConfig['resQuery'];

			//Get SPARQL Query as text
			if (serviceConfig.customized) {
				//Custom query function
				var customQuery = new CustomQuery();
				query = customQuery[serviceConfig['function']](serviceConfig, params, query);
			} else {
				//Parse the rdfSql first and inject parameters:query:
				var sqlParser = new SqlParser(query, params, serviceConfig);
				sqlParser.replace();
				query = sqlParser.getRdfSql();
			}

			var offset = 0;
			if (params['offset'] !== undefined) {
				offset = params['offset'];
				query = query + " OFFSET " + params['offset'];
			}
			if (params['limit'] !== undefined) {
				query = query + " LIMIT " + params['limit'];
			}/* else if (params['pageNo'] !== undefined && params['pageSize'] !== undefined) {
				var pageSize = Number(params['pageSize']);
				var pageNo = Number(params['pageNo']) - 1;
				query = query + " ORDER BY ?vols";
				query = query + " LIMIT " + pageSize;
				query = query + " OFFSET " + (pageNo * pageSize);
			}*/ else {
				query = query + " LIMIT " + limit;
			}

			var sqlPorter = new PostCode(host, defaultGraphUrl, query, shouldSponge, format, timeout, debug);
			logger.info("sqlPorter object: %o",sqlPorter);
			const postQuery = logger.startTimer();
			body = sqlPorter.postQuery();
			body.then(function(resBody) {
				//parse result into jsonConfig
				postQuery.done({ message: "Got results from SPARQL endpoint"});

				var jsonldBody = JSON.parse(resBody.getBody('UTF-8'));
				logger.info("The jsonld is empty: %o",_.isEmpty(jsonldBody));
				if (_.isEmpty(jsonldBody)) {
					res.status(404).end();
					return;
				}
				var postPagingDefer = Q.defer();

				//Paging handler
				if (serviceConfig.paging !== undefined) {				
					if (jsonldBody["@graph"]!==undefined&&jsonldBody["@graph"][0][serviceConfig.paging.field].length === limit) {
						tracePage(serviceConfig,offset,limit).then(function(resPage) {
							jsonldBody["@graph"][0][serviceConfig.paging.field].push.apply(jsonldBody["@graph"][0][serviceConfig.paging.field],resPage);
							postPagingDefer.resolve(jsonldBody);
						})
					} else{
						postPagingDefer.resolve(jsonldBody);
					}
					
				} else{
					postPagingDefer.resolve(jsonldBody);
				}
				
				postPagingDefer.promise.then(function(resPage) {
					if (serviceConfig['context'] !== undefined) {
						//do flatten and compacting jsonld
						logger.info("Loaded context is %o",serviceConfig['context']);
						logger.info("Pre-compacted results: %o",resPage);
						fs.readFile(serviceConfig['context'],function(e,d){
							if (e) {
								logger.error("Error: %o",e);
								throw e;
							}
							else {
								var context = JSON.parse(d);
								var promises = jsonld.promises;
								const compactandcontext = logger.startTimer();
								var promise = promises.compact(resPage, context);
								promise.then(function(compacted) {
									compactandcontext.done({ message: "Finished compating"});
									if ('visibility' in compacted) {
										logger.info("Visibility: %s", compacted.visibility);
										if (compacted.visibility == 'private') {
											res.status(401).end();
											return;
										}
									}
									res.end(JSON.stringify(compacted));
									return;
								}, function(err) {
									logger.error("Error: %o",err);
									throw err;
								});
							}
						});
					} else {
						res.end(JSON.stringify(resPage));
						return;
					}
				})
			})
		} catch (err) {
			errorStatus.message = err.message;
			logger.error("Threw error trying to send query: %o",errorStatus);
			res.end(JSON.stringify(errorStatus));
			return;
		}
	} catch (err) {
		errorStatus.message = err.message;
		logger.error("ERROR MESSAGE: %o",errorStatus);
		res.end(JSON.stringify(errorStatus));
		return;
	}
}

//pre defined custom function
function CustomQuery() {

}

CustomQuery.prototype.listCustom = function(config, param, query) {
	if (param['vis'] == undefined) {
		throw Error("parameter vis is missing");
	}
	var condition = " VALUES ( ";
	var values = "{ ( ";
	condition += " ?vis ";
	values += " \"" + param['vis'] + "\" ";
	if (param['creator'] !== undefined) {
		condition += " ?cre ";
		values += " \"" + param['creator'] + "\" ";
	}
	if (param['group'] !== undefined) {
		condition += " ?group ";
		values += " \"" + param['group'] + "\" ";
	}
	condition += " ) "
	values += " ) }"
	return query + condition + values + " }"
}

//SqlParser class
//class to parse sql query and replace particular tags with given parameters set
function SqlParser(rdfSql, params, parser_config) {
	this.beginTag = ':=';
	this.endTag = '=:';
	this.rdfSql = rdfSql;
	this.params = params;
	this.config = parser_config;
}

SqlParser.prototype.tagit = function(myString) {
	return this.beginTag + myString + this.endTag;
}

SqlParser.prototype.getRdfSql = function() {
	return this.rdfSql;
}

SqlParser.prototype.replace = function() {
	var self = this;
	Object.keys(this.params).forEach(function(key) {
		var value = self.params[key];
		if (self.config[key] !== undefined) {
			var transform = self.config[key]['transform'];
			logger.info("rdfSql type: %s",typeof self.rdfSql);
//			console.log("rdfSql: %s",self.rdfSql);
			self.rdfSql = self.rdfSql.replace(transform, value)
		}
	});

}

//PostCode class
//class to post request into virtuoso api
function PostCode(host, defaultGraphUrl, query, shouldSponge, format, timeout, debug) {
	this.host = host;
	this.defaultGraphUrl = defaultGraphUrl;
	this.query = query;
	this.shouldSponge = shouldSponge;
	this.format = format;
	this.timeout = timeout;
	this.debug = debug;
}

PostCode.prototype.postQuery = function() {
	// Build the post string from an object
	var post_data = querystring.stringify({
		'default-graph-uri': this.defaultGraphUrl,
		'query': this.query,
		'should-sponge': this.shouldSponge,
		'format': this.format,
		'timeout': this.debug
	});


	var queryString = {
		'default-graph-uri': this.defaultGraphUrl,
		'query': this.query,
		//		'should-sponge': this.shouldSponge,
		'format': this.format,
		'timeout': this.timeout,
		'debug': this.debug
	}

	// An object of options to indicate where to post to

	var post_options = {
		host: this.host,
		path: '/' + config.get('Read-Only_Endpoint.path'),
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		}
	}

	var get_options = {
		url: this.host + '/' + config.get('Read-Only_Endpoint.path'),
		qs: queryString,
	};

	// Synchronous get request
	return thenRequest('POST', this.host + '/' + config.get('Read-Only_Endpoint.path'), {
		qs: queryString
	});

}