//reading file system / file
var fs = require("fs");
//var http = require('http');
var request = require("request");
//url parser
var url = require('url');
//Library for input sanitation
var validator = require('validator');
//jsonld library
var jsonld = require('jsonld');
//XML parsing library
var xml2js = require('xml2js');
//config library
var config = require('config');

var functionConfigs;
fs.readFile('./SPARQL/viewWorksets/config-hashed.json', function(err,data) {
	functionConfigs = JSON.parse(data);
});

function getParameters(req,function_name) {
	var requiredParam = functionConfigs[function_name]['required'];
	var optionalParam = functionConfigs[function_name]['optional'];

	if ('id' in req.params) {
		let splice_position = req.params.id.indexOf(':/') + 2;
		req.params.id = req.params.id.substring(0,splice_position) + '/' + req.params.id.substring(splice_position);
	}

	var user_submitted_params = url.parse(req.url, true).query;
	var approved_params = {};
	console.log(user_submitted_params);
	user_submitted_params = Object.assign(user_submitted_params,req.params);
	console.log(user_submitted_params);

	//Make sure all required parameters are present
	for (var index = 0; index < requiredParam.length; index++) {
		if (!(requiredParam[index] in user_submitted_params)) {
			throw Error("parameter " + requiredParam[index] + " is missing");
		}
	}

	for (var key in user_submitted_params) {
		//Make sure no extranious parameters are present
		if (!requiredParam.includes(key) && !optionalParam.includes(key)) {
			throw Error("parameter " + key + " is not allowed");
		}

		//Make sure parameter value is of the correct type
		var verifyTypeFunction = undefined;
		if (functionConfigs[function_name][key]['type'] == 'url') {
			verifyTypeFunction = validator.isURL;
		}
		else if (functionConfigs[function_name][key]['type'] == 'integer') {
			verifyTypeFunction = validator.isInt;
		}
		else if (functionConfigs[function_name][key]['type'] == 'string') {
			user_submitted_params[key] = validator.escape(user_submitted_params[key]);
		}
		else {
			throw Error("Input type " + functionConfigs[function_name][key]['type'] + " not implemented");
		}

		if (functionConfigs[function_name][key]['type'] != 'string') {
			if (verifyTypeFunction(user_submitted_params[key])) {
				approved_params[key] = user_submitted_params[key];
			}
			else {
				throw Error("Parameter " + key + " must be a " + functionConfigs[function_name][key]['type']);
			}
		}
		else {
			approved_params[key] = user_submitted_params[key];
		}
	}

	return approved_params;
}

function sendSPARQLQuery(query,serviceMethod,params,req,res) {
	console.log("Sending request to %s",config.get('Read-Only_Endpoint.domain') + ':' + config.get('Read-Only_Endpoint.port') + '/' + config.get('Read-Only_Endpoint.path'));
	request({
		method: 'POST',
		uri: config.get('Read-Only_Endpoint.domain') + ':' + config.get('Read-Only_Endpoint.port') + '/' + config.get('Read-Only_Endpoint.path'),
		headers: {
			'Content-Type': 'application/x-www-form-unencoded',
		},
		form: {
			'default-graph-uri': '',
			'query': query,
			'format': 'application/ld+json'
		}
	}, function (er,rs,bd) {
		if (er) {
			res.write("ERROR IN SENDING REQUEST");
			res.write(er);
		}
		else {
			console.log("REQUEST WORKED");
			console.log("Response: %s",bd);


			console.log("Getting context from %s",functionConfigs[serviceMethod]['context']);
			fs.readFile(functionConfigs[serviceMethod]['context'],function(e,d){
				if (e) {
					console.log("Error: %o",e);
					throw e;
				}
				else {
					console.log("Unparsed conted doucment %s",d);
					var context = JSON.parse(d);

					var promises = jsonld.promises;
					var promise = promises.compact(JSON.parse(bd),context);
					promise.then(function(compacted) {
						if (serviceMethod == 'getWorksetPage' || serviceMethod == 'getBIBFWorksetPage') {
							var view = undefined;
							if (serviceMethod == 'getWorksetPage') {
								view = 'volumes'
							}
							else {
								view = 'bibframe'
							}
							var target = undefined;
							var ext = undefined;
							for (var component in compacted['graph']) {
								if (compacted['graph'][component]['type'] == 'WorksetPage') {
									target = compacted['graph'][component];
								}
								else if (compacted['graph'][component]['type'] == 'Workset') {
									ext = compacted['graph'][component]['extent'];
								}
							}

							if (target['startIndex'] > 1) {
								target['first'] = config.get('Read-Only_Endpoint.domain') + '/api/worksets/' + params['id'] + '/' + view + '?page=1&per_page=' + params['per_page'];
							}

							if (params['page'] > 1) {
								target['previous'] = config.get('Read-Only_Endpoint.domain') + '/api/worksets/' + params['id'] + '/' + view + '?page=' + (params['page']-1) + '&per_page=' + params['per_page'];
							}

							if ((params['page'])*params['per_page'] < ext) {
								target['next'] = config.get('Read-Only_Endpoint.domain') + '/api/worksets/' + params['id'] + '/' + view + '?page=' + (parseInt(params['page'])+1) + '&per_page=' + params['per_page'];

								var last_page = parseInt(params['page']);
								while ((last_page-1)*params['per_page'] < ext) {
									last_page++;
								}
								last_page = last_page - 1;
								target['last'] = config.get('Read-Only_Endpoint.domain') + '/api/worksets/' + params['id'] + '/' + view + '?page=' + last_page + '&per_page=' + params['per_page'];
							}
						}

						if (req['headers']['accept'].indexOf('application/ld+json') !== -1) {
							/*Return results as JSON-LD*/
							res.writeHead(200, {"Content-Type": "application/ld+json"});
							res.end(JSON.stringify(compacted));
						}
						else {
							/*Return results as HTML (not implemented yet, so still returning JSON-LD)*/
							res.writeHead(200, {"Content-Type": "application/ld+json"});
							res.end(JSON.stringify(compacted));
						}
						return;
					}, function(err) {
						res.write("ERROR IN PROMISE");
						res.end(err);
					});
				}
			});
		}
	});
}

function deleteWorkset(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	var method_name = "deleteWorkset";

	var params = getParameters(req,method_name);
	var template_file = functionConfigs[method_name]['query'];
	fs.readFile('./SPARQL/viewWorksets/' + template_file, function(err,data) {
		if (err) {
			console.log("ERROR READING FILE: %o",err);
		}
		else {
			try {
				var data_string = data.toString('utf8');
				params['id'] = params['id'].replace('wsid','graph')
				console.log("Deleting workset %s",params['id']);
				if (params['id'].substring(0,config.get('Read-Write_Endpoint.domain').length+7) == config.get('Read-Write_Endpoint.domain') + '/graph/') {
					data_string = data_string.replace(new RegExp(functionConfigs[method_name]['id']['transform'].replace(/\$/g,'\\$'),'g'),'<' + params['id'] + '>');
				}
				else {
					throw Error("Graph id must start with '" + config.get('Read-Write_Endpoint.domain') + "/graph/'");
				}

				request({
					method: 'POST',
					uri: config.get('Read-Only_Endpoint.domain') + ':' + config.get('Read-Only_Endpoint.port') + '/' + config.get('Read-Only_Endpoint.path'),
					headers: {
						'Content-Type': 'application/x-www-form-unencoded',
					},
					form: {
						'default-graph-uri': '',
						'query': data_string,
						'format': 'application/ld+json'
					}
				}, function (er,rs,bd) {
					if (er) {
						throw Error(er);
					}
					else {
						try {
							console.log("SELECTED WORKSET, PROCEDING TO DELETE");

							var creator_varified = false;
							var parser = new xml2js.Parser();
							console.log("Workset contents: %s",bd);
							parser.parseString(bd, function(err,result) {
								console.log("Parsed XML: %o",result);
								var creator_names = [];
								console.log("Result: %o",'result' in result['sparql']['results'][0]);
								if ('result' in result['sparql']['results'][0]) {
									var results = result['sparql']['results'][0]['result'];
									for (var i = 0; i < results.length; i++) {
										fs.readFile('./SPARQL/viewWorksets/' + functionConfigs[method_name]['delete_query'], function(e,d) {
											if (e) {
												console.log("ERROR READING FILE: %o",e);
											}
											else {
												var delete_query_string = d.toString('utf8');
												delete_query_string = delete_query_string.replace(new RegExp(functionConfigs[method_name]['id']['transform'].replace(/\$/g,'\\$'),'g'),'<' + params['id'] + '>');
												console.log("Delete query string: %s",delete_query_string);

												request({
													method: 'POST',
													uri: config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'),
													port: config.get('Read-Write_Endpoint.port'),
													headers: {
														'Content-Type': 'application/x-www-form-unencoded',
													},
													form: {
														'default-graph-uri': '',
														'query': delete_query_string,
														'format': 'application/ld+json'
													},
													auth: {
														user: config.get('Read-Write_Endpoint.username'),
														password: config.get('Read-Write_Endpoint.password'),
														sendImmediately: false
													}
												}, function (e,r,b) {
													if (e) {
														throw Error(e);
													}
													else {
														res.status(204).end();
													}
												});
											}
										});
									}
								}
								else {
									throw Error("Cannot delete workset that does not exist");
								}
							});
						}
						catch (err) {
							errorStatus.message = err.message;
							res.end(JSON.stringify(errorStatus));
							return;
						}
					}
				});
			}
			catch (err) {
				errorStatus.message = err.message;
				res.end(JSON.stringify(errorStatus));
				return;
			}
		}
	})
}

function getWorksetPage(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	var method_name = 'getWorksetPage';

	var params = getParameters(req,method_name);
	if ('ar' in params) {
		var template_file = functionConfigs[method_name]['filterd_query'];
	}
	else {
		var template_file = functionConfigs[method_name]['query'];
	}
	fs.readFile('./SPARQL/viewWorksets/' + template_file, function(err,data) {
		if (err) {
			console.log("ERROR READING FILE: %o",err);
		}
		else {
			try {
				var data_string = data.toString('utf8');
				data_string = data_string.replace(new RegExp(functionConfigs[method_name]['id']['transform'].replace(/\$/g,'\\$'),'g'),'<' + params['id'] + '>');

				if (!('page' in params)) {
					params['page'] = functionConfigs['defaultPageNo'];
				}

				if (!('per_page' in params)) {
					params['per_page'] = functionConfigs['defaultPageSize'];
				}

				if (params['per_page'] < 1) {
					throw Error(params['per_page'] + " is an invalid page size");
				}

				var workset_page = '<' + params['id'] + '?page=' + params['page'] + '&per_page=' + params['per_page'] + '>';
				data_string = data_string.replace(/\$wsP\$/g,workset_page);
				data_string = data_string.replace(/\$limit\$/g,params['per_page']);
				var offset = (params['page']-1)*params['per_page'];

				if (offset < 0) {
					throw Error(params['page'] + " is an invalid page number");
				}

				data_string = data_string.replace(/\$offset\$/g,offset);
				var startIndex = offset+1;
				data_string = data_string.replace(/\$startIndex\$/g,startIndex);

				if ('ar' in params) {
					if (params['ar'] == 'pd' || params['ar'] == 'ic') {
						var workset_filtered = '<' + params['id'] + '?ar=' + params['ar'] + '>';
						data_string = data_string.replace(/\$wsF\$/g,workset_filtered);
					}
					else {
						throw Error(params['ar'] + " is not a valid ar value");
					}
				}

				sendSPARQLQuery(data_string,'getWorksetPage',params,req,res);
			} catch (err) {
				errorStatus.message = err.message;
				res.end(JSON.stringify(errorStatus));
				return;
			}
		}
	});
}

function getBIBFWorksetPage(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	var method_name = 'getBIBFWorksetPage';

	var params = getParameters(req,method_name);
	if ('ar' in params) {
		var template_file = functionConfigs[method_name]['filterd_query'];
	}
	else {
		var template_file = functionConfigs[method_name]['query'];
	}
	fs.readFile('./SPARQL/viewWorksets/' + template_file, function(err,data) {
		if (err) {
			console.log("ERROR READING FILE: %o",err);
		}
		else {
			try {
				var data_string = data.toString('utf8');
				data_string = data_string.replace(new RegExp(functionConfigs[method_name]['id']['transform'].replace(/\$/g,'\\$'),'g'),'<' + params['id'] + '>');

				if (!('page' in params)) {
					params['page'] = functionConfigs['defaultPageNo'];
				}

				if (!('per_page' in params)) {
					params['per_page'] = functionConfigs['defaultPageSize'];
				}

				if (params['per_page'] < 1) {
					throw Error(params['per_page'] + " is an invalid page size");
				}

				var workset_page = '<' + params['id'] + '?page=' + params['page'] + '&per_page=' + params['per_page'] + '>';
				data_string = data_string.replace(/\$wsP\$/g,workset_page);
				data_string = data_string.replace(/\$limit\$/g,params['per_page']);
				var offset = (params['page']-1)*params['per_page'];

				if (offset < 0) {
					throw Error(params['page'] + " is an invalid page number");
				}

				data_string = data_string.replace(/\$offset\$/g,offset);
				var startIndex = offset+1;
				data_string = data_string.replace(/\$startIndex\$/g,startIndex);

				if ('ar' in params) {
					if (params['ar'] == 'pd' || params['ar'] == 'ic') {
						var workset_filtered = '<' + params['id'] + '?ar=' + params['ar'] + '>';
						data_string = data_string.replace(/\$wsF\$/g,workset_filtered);
					}
					else {
						throw Error(params['ar'] + " is not a valid ar value");
					}
				}

				sendSPARQLQuery(data_string,method_name,params,req,res);
			} catch (err) {
				errorStatus.message = err.message;
				res.end(JSON.stringify(errorStatus));
				return;
			}
		}
	});
}

function listWorksetsContaining(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	var method_name = 'listWorksetsContaining';

	var params = getParameters(req,method_name);
	var volume_urls = params['contains_vol'].split(',');

	var template_file = functionConfigs[method_name]['query'];
	fs.readFile('./SPARQL/viewWorksets/' + template_file, function(err,data) {
		if (err) {
			console.log("ERROR READING FILE: %o",err);
		}
		else {
			try {
				var data_string = data.toString('utf8');
				data_string = data_string.replace(new RegExp(functionConfigs[method_name]['contains_vol']['transform'].replace(/\$/g,'\\$'),'g'),'<' + volume_urls[0] + '>');

				if (volume_urls.length > 1) {
					var second_template = functionConfigs[method_name]['secondary_query'];
					fs.readFile('./SPARQL/viewWorksets/' + second_template, function(e,d) {
						if (e) {
							console.log("ERROR READING FILE: %o",e);
						}
						else {
							try {
								var d_string = d.toString('utf8');
								for (var index = 1; index < volume_urls.length; index++) {
									data_string = data_string.substring(0,data_string.length-1) + d_string.replace(new RegExp(functionConfigs[method_name]['contains_vol']['transform'].replace(/\$/g,'\\$'),'g'),'<' + volume_urls[index] + '>');
								}

								sendSPARQLQuery(data_string,'listWorksetsContaining',params,req,res);
							} catch (e) {
								errorStatus.message = e.message;
								res.end(JSON.stringify(errorStatus));
								return;
							}
						}
					});
				}
				else {
					console.log(data_string);
					sendSPARQLQuery(data_string,'listWorksetsContaining',params,req,res);
				}
			} catch (err) {
				errorStatus.message = err.message;
				res.end(JSON.stringify(errorStatus));
				return;
			}
		}
	});
}

exports.runSPARQLQuery = function(req,res) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

	var errorStatus = {
		errorcode: -1
	};

	try {
		var serviceMethod = req.params.serviceMethod;

		if (serviceMethod == 'getWorksetPage' || serviceMethod == 'listWorksetsContaining' || serviceMethod == 'getVolume' || serviceMethod == 'deleteWorkset' || serviceMethod == 'getBIBFWorksetPage' ) {
			if (serviceMethod == 'getWorksetPage') {
				getWorksetPage(req,res);
			}
			else if (serviceMethod == 'listWorksetsContaining') {
				listWorksetsContaining(req,res);
			}
			else if (serviceMethod == 'deleteWorkset') {
				deleteWorkset(req,res);
			}
			else if (serviceMethod == 'getBIBFWorksetPage') {
				getBIBFWorksetPage(req,res);
			}
		}
		else {
			throw Error(req.params.serviceMethod + " does not exist");
		}
	} catch (err) {
		errorStatus.message = err.message;
		res.end(JSON.stringify(errorStatus));
		return;
	}
}

exports.runAPIRequest = function(req,res,serviceMethod) {
	var errorStatus = {
		errorcode: -1
	};

	try {
		if (serviceMethod == 'getWorksetPage' || serviceMethod == 'listWorksetsContaining' || serviceMethod == 'getVolume' || serviceMethod == 'deleteWorkset' || serviceMethod == 'getBIBFWorksetPage' ) {
			if (serviceMethod == 'getWorksetPage') {
				getWorksetPage(req,res);
			}
			else if (serviceMethod == 'listWorksetsContaining') {
				listWorksetsContaining(req,res);
			}
			else if (serviceMethod == 'deleteWorkset') {
				deleteWorkset(req,res);
			}
			else if (serviceMethod == 'getBIBFWorksetPage') {
				getBIBFWorksetPage(req,res);
			}
		}
		else {
			throw Error(req.params.serviceMethod + " does not exist");
		}
	} catch (err) {
		errorStatus.message = err.message;
		res.end(JSON.stringify(errorStatus));
		return;
	}
}
