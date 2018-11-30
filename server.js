//author: nnp2

//reading file system / file
var fs = require("fs");
//http and rest nodejs library
var http = require('http');
var https = require('https');
//url parser
var url = require('url');
//config library
var config = require('config');
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var app_rw = express();
app.use(express.json());
//app_rw.use(express.json());
app_rw.use(bodyParser.json({limit: '75mb'}));

//custom built modules
var collectionIngest = require('./collectionIngest.js');
var dcWSfetch = require('./dcWSfetch.js');
var viewWorksets = require('./viewWorksets.js');
var admin = require('./admin.js')

//Run the server
var read_only_server = http.createServer(app);
var read_write_server = http.createServer(app_rw);

read_only_server.listen(8082, function() {
	var host = read_only_server.address().address;
	var port = read_only_server.address().port;
	console.log("Read-Only server listening on %s port %i",host,port);
	read_only_server.maxConnections = 100;
})
read_write_server.listen(8083, function() {
	var host = read_write_server.address().address;
	var port = read_write_server.address().port;
	console.log("Read/Write server listening on " + host + " port " + port);
	read_write_server.maxConnections = 100;
})

function requireHTTPS(req, res, next) {
	if (!req.secure) {
		var host_string = req.get('host');
//		return res.redirect('https://' + req.get('host') + req.url);
		return res.redirect('https://' + host_string.substring(0,host_string.indexOf(':')) + req.url);
	}
	next();
}

app_rw.post('/api/worksets', function(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	try {
		console.log("Got collectionIngest request");
		collectionIngest.submitWorkset(req,res);
	}
	catch (err) {
		errorStatus.message = err.message;
		res.end(JSON.stringify(errorStatus));
		return;
	}
})

app_rw.delete('/api/worksets/:id(http[s]?:/' + config.get('Read-Write_Endpoint.api_domain') + '/wsid/[0-9a-z\-]{0,})', function(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	try {
		console.log('Got delete request');
		console.log('Got request parameters: %o', req);
		viewWorksets.runAPIRequest(req,res,'deleteWorkset');
	}
	catch (err) {
		errorStatus.message = err.message;
		res.end(JSON.stringify(errorStatus));
		return;
	}
})

app_rw.put('/api/users/:username/rename', function(req,res) {
	console.log("Got rename request");
	var user_submitted_params = url.parse(req.url, true).query;
	console.log(user_submitted_params);

	if ('new_alias' in user_submitted_params) {
		admin.runAPIRequest(req,res,'renameUser');
	}
	else {
		res.status(400).end();
	}
})

app.get('/api/health', function(req,res) {
	console.log("Got health check");

	admin.runAPIRequest(req,res,'healthCheck');
})

app.get('/api/worksets', function(req,res) {
	console.log("Got base get request");
	var user_submitted_params = url.parse(req.url, true).query;
	console.log(user_submitted_params);

	if ('vis' in user_submitted_params && 'contains_vol' in user_submitted_params) {
		res.status(400).end();
	}
	else if ('vis' in user_submitted_params) {
		console.log('Got list request');
		if (user_submitted_params.vis == 'public') {
			dcWSfetch.runAPIRequest(req,res,'list');
		}
		else {
			res.status(401).end();
		}
	}
	else if ('contains_vol' in user_submitted_params) {
		console.log('Got worksests containing request');
		viewWorksets.runAPIRequest(req,res,'listWorksetsContaining');
	}
	else {
		res.status(400).end();
	}
})

app.get('/api/worksets/:id(http[s]?:/' + config.get('Read-Only_Endpoint.api_domain') + '/wsid/[0-9a-z\-]{0,})/', function(req,res) {
	console.log('Got getDescription request');
	dcWSfetch.runAPIRequest(req,res,'getDescription');
})

app.get('/api/worksets/:id(http[s]?:/' + config.get('Read-Only_Endpoint.api_domain') + '/wsid/[0-9a-z\-]{0,})/:view', function(req,res) {
	if (req.params.view == 'items') {
		console.log('Got getItems request');
		delete req.params.view;
		dcWSfetch.runAPIRequest(req,res,'getItems');
	}
	else if (req.params.view == 'volumes') {
		console.log('Got getWorksetPage request');
		delete req.params.view;
		viewWorksets.runAPIRequest(req,res,'getWorksetPage');
	}
	else if (req.params.view == 'description') {
		console.log('Got getShortDescription request');
		delete req.params.view;
		dcWSfetch.runAPIRequest(req,res,'getShortDescription');
	}
	else if (req.params.view == 'bibframe') {
		console.log('Got getBIBFWorksetPage request');
		delete req.params.view;
		viewWorksets.runAPIRequest(req,res,'getBIBFWorksetPage');
	}
	else {
		res.status(400).end();
	}
})