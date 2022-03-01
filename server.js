//author: nnp2

//reading file system / file
import fs from "fs";
//http and rest nodejs library
import http from 'http';
import https from 'https';
//url parser
import url from 'url';
//logger
import { createLogger, format, transports } from 'winston';
//config library
import config from 'config';
import express from 'express';
import bodyParser from 'body-parser';
var app = express();
var app_rw = express();
app.use(express.json());
//app_rw.use(express.json());
app_rw.use(bodyParser.json({limit: '75mb'}));

//custom built modules
import * as collectionIngest from './collectionIngest.js';
import * as dcWSfetch from './dcWSfetch.js';
import * as viewWorksets from './viewWorksets.js';
import * as admin from './admin.js';

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

//Run the server
var read_only_server = http.createServer(app);
var read_write_server = http.createServer(app_rw);

read_only_server.listen(8082, function() {
	var host = read_only_server.address().address;
	var port = read_only_server.address().port;
	logger.info("Read-Only server listening on %s port %i",host,port);
	read_only_server.maxConnections = 100;
})
read_write_server.listen(8083, function() {
	var host = read_write_server.address().address;
	var port = read_write_server.address().port;
	logger.info("Read/Write server listening on " + host + " port " + port);
	read_write_server.maxConnections = 100;
})

logger.info('HOSTNAME: %s',config.util.getEnv('HOSTNAME'));

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
		logger.info("Got collectionIngest request");
		logger.info("Content length: %d MB", (req.headers['content-length'] / (1024 * 1024)).toFixed(2));
		collectionIngest.submitWorkset(req,res);
	}
	catch (err) {
		errorStatus.message = err.message;
		logger.error("ERROR MESSAGE: %o",errorStatus);
		res.end(JSON.stringify(errorStatus));
		return;
	}
})

app_rw.delete('/api/worksets/:id(http[s]?:/' + config.get('Read-Write_Endpoint.api_domain') + '/wsid/[0-9a-z\-]{0,})', function(req,res) {
	var errorStatus = {
		errorcode: -1
	};

	try {
		logger.info('Got delete request');
		logger.info('Got request parameters: %o', req);
		viewWorksets.runAPIRequest(req,res,'deleteWorkset');
	}
	catch (err) {
		errorStatus.message = err.message;
		logger.error("ERROR MESSAGE: %o",errorStatus);
		res.end(JSON.stringify(errorStatus));
		return;
	}
})

app_rw.put('/api/users/:username/rename', function(req,res) {
	logger.info("Got rename request");
	var user_submitted_params = url.parse(req.url, true).query;
	logger.info("User submitted params: %o",user_submitted_params);

	if ('new_alias' in user_submitted_params) {
		admin.runAPIRequest(req,res,'renameUser');
	}
	else {
		logger.error("No new alias submitted");
		res.status(400).end();
	}
})

app.get('/api/health', function(req,res) {
	logger.info("Got health check");

	admin.runAPIRequest(req,res,'healthCheck');
})

app.get('/api/worksets', function(req,res) {
	logger.info("Got base get request");
	var user_submitted_params = url.parse(req.url, true).query;
	logger.info("User submitted params: %o",user_submitted_params);

	if ('vis' in user_submitted_params && 'contains_vol' in user_submitted_params) {
		logger.error("Contradictory params");
		res.status(400).end();
	}
	else if ('vis' in user_submitted_params) {
		logger.info('Got list request');
		if (user_submitted_params.vis == 'public') {
			dcWSfetch.runAPIRequest(req,res,'list');
		}
		else {
			res.status(401).end();
		}
	}
	else if ('contains_vol' in user_submitted_params) {
		logger.info('Got worksests containing request');
		viewWorksets.runAPIRequest(req,res,'listWorksetsContaining');
	}
	else {
		logger.error("No valid params");
		res.status(400).end();
	}
})

app.get('/api/worksets/:id(http[s]?:/' + config.get('Read-Only_Endpoint.api_domain') + '/wsid/[0-9a-z\-]{0,})/', function(req,res) {
	logger.info('Got getDescription request');
	dcWSfetch.runAPIRequest(req,res,'getDescription');
})

app.get('/api/worksets/:id(http[s]?:/' + config.get('Read-Only_Endpoint.api_domain') + '/wsid/[0-9a-z\-]{0,})/:view', function(req,res) {
	if (req.params.view == 'items') {
		logger.info('Got getItems request');
		delete req.params.view;
		dcWSfetch.runAPIRequest(req,res,'getItems');
	}
	else if (req.params.view == 'volumes') {
		logger.info('Got getWorksetPage request');
		delete req.params.view;
		viewWorksets.runAPIRequest(req,res,'getWorksetPage');
	}
	else if (req.params.view == 'description') {
		logger.info('Got getShortDescription request');
		delete req.params.view;
		dcWSfetch.runAPIRequest(req,res,'getShortDescription');
	}
	else if (req.params.view == 'bibframe') {
		logger.info('Got getBIBFWorksetPage request');
		delete req.params.view;
		viewWorksets.runAPIRequest(req,res,'getBIBFWorksetPage');
	}
	else {
		res.status(400).end();
	}
})