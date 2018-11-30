//var http = require('http');
var request = require("request");
//config library
var config = require('config');

function sendSPARQLQuery(query,serviceMethod,params,req,res) {
	console.log("Sending request to %s",config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'));
	request({
		method: 'POST',
		uri: config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'),
		port: config.get('Read-Write_Endpoint.port'),
		headers: {
			'Content-Type': 'application/x-www-form-unencoded',
		},
		form: {
			'default-graph-uri': '',
			'query': query,
			'format': 'text/html'
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
			console.log("Results: %s",b);
			res.status(200).end();
		}
	});
}

function healthCheck(req,res) {
	res.writeHead(200, {"Content-Type": "application/json"});
	res.end(JSON.stringify({"health_status": 0}));
}

exports.runAPIRequest = function(req,res,serviceMethod) {
	var errorStatus = {
		errorcode: -1
	};

	try {
		if (serviceMethod == 'healthCheck' ) {
			healthCheck(req,res);
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