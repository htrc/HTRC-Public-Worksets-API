//reading file system / file
import fs from "fs";
//var http = require('http');
import needle from 'needle';
//Library to handle forms
import formidable from "formidable";
//Library for input sanitation
import validator from 'validator';
//uuid library
import { v1 as uuidv1 } from 'uuid';
//logging library
import { createLogger, format, transports } from 'winston';
//config library
import config from 'config';
//ajv library
import Ajv from 'ajv';
// validator
var ajv = new Ajv();

var SOURCE_DATA_SCHEMA = {
	"type": "object",
	"properties": {
		"extent": { "type": [ "integer", "string" ] },
		"created": { "type": "string" },
		"title": { "type": "string" },
		"description": { "type": "string" },
		"gathers": { 
			"type": "array",
			"items": { 
				"type": "object", 
				"properties": {
					"htitem_id": { "type": "string" }
				}
			}
		}
	}
};

var validate = ajv.compile(SOURCE_DATA_SCHEMA);

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

function extractCollectionIDFromURL(url) {
	return url.substring(url.indexOf('c=')+2);
}

function addPageSynchronously(query_index,queries) {
	needle.post(config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'),{
		'default-graph-uri': '',
		'query': queries[query_index],
		'format': 'text/html'
	},{
		username: config.get('Read-Write_Endpoint.username'),
		password: config.get('Read-Write_Endpoint.password'),
		auth: 'digest'
	}, function (er,rs,bd) {
		if (er) {
			logger.error("ERROR IN ADDING VOLUMES TO WORKSET: %o",er)
		}
		else {
			if (query_index+1 < queries.length) {
				logger.info("Added chunk of 1000 volumes");
				addPageSynchronously(query_index+1,queries);
			}
		}
	});
}

function gathersPaging(workset,page_size,graph_url,target_url) {
	var base_text = 'PREFIX rdf:	<http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n';
	base_text += 'PREFIX ns1:	<http://wcsa.htrc.illinois.edu/>\n';
	base_text += 'PREFIX ns2:	<http://purl.org/dc/terms/>\n';
	base_text += 'PREFIX ns3:	<http://www.europeana.eu/schemas/edm/>\n';
	base_text += 'PREFIX fabio:	<http://purl.org/spar/fabio/>\n\n';
	base_text += 'INSERT INTO ' + graph_url + '\n';
	base_text += '{\n';

	var queries = []

	for (var volume_counter = page_size; volume_counter < workset['gathers'].length; volume_counter++) {
		var new_query = '';
		if (volume_counter % page_size == 0) {
			new_query = base_text;
		}

		new_query += target_url + '\tns3:gathers\t<http://hdl.handle.net/2027/' + workset['gathers'][volume_counter]['htitem_id'] + '> .\n';

		if (volume_counter % page_size == page_size-1 || volume_counter == workset['gathers'].length-1) {
			new_query += '}';
			queries.push(new_query);
		}
	}

	addPageSynchronously(0,queries);
}

/*
 * Generic Workset Object should be able to be built from any of our input sources. Once they have all been normalized to this format, this format
 * can be used to build the SPARQL queries that we use to submit the Workset to Virtuoso. It should also be usable to create the public domain version
 * of the Workset that will be sent to the Registry.
 * 	REQUIRED FIELDS:
 *		- created: Date the workset was created
 *		- extent: Number of volumes in the workset
 *		- primary_creator: GUID of user creating workset who will be able to edit it in the future. Presumably the person who is logged in to the Portal.
 *		- title: Workset title
 *		- abstract: Description of the workset
 *		- gathers: List of volumes in the workset
 *		- private: defaults to False, if private workset the value is True
 *	OPTIONAL FIELDS:
 *		- origin: URL of collection workset was derived from
 *		- additional_creators: List of other people to credit with creation of workset. Won't be able to edit. Last one is the collection creator.
 *		- research_motivation: Reason for creating the workset
 *		- criteria: Why these specific volumes are included
 *	GENERATED FIELDS:
 *		- id: ID of workset we can use to retrieve it
 *
 *	NON-SUBMITED FIELDS THAT NEED TO BE GENERATED (To Do)
 *		- temporal_coverage: Use the volume-level created field to find this. This field needs to be revised across all volumes to make it clear its a date
 *		- language: Collect all language codes from all volumes. Volume-level metadata still needs laguage info added.
 */
function buildWorksetObject(fields) {
	var workset = {};

	logger.info("Validating user input...");
	if ('source_data' in fields && validate(fields.source_data)) {
		var collection = fields.source_data;
	}
	else {
		logger.error("Missing source_data");
		return undefined;
	}
	logger.info("Validation successful");

	workset['id'] = uuidv1();
	logger.debug("Created workset id: %s", workset['id']);

	var today = new Date();
	var dd = today.getDate();
	var mm = today.getMonth() + 1;
	var yyyy = today.getFullYear();
	if (dd<10) {
		dd = '0' + dd;
	}
	if (mm<10) {
		mm = '0' + mm;
	}

	workset['created'] = yyyy + '-' + mm + '-' + dd;

	logger.debug("Checking for private workset info");
	if ('private_workset' in fields) {
		workset['private'] = (fields.private_workset == true);
		logger.info("Private workset? %o",fields.private_workset == true);
	}
	else {
		return undefined;
	}

	logger.debug("Checking for extent info");
	if ('extent' in collection && typeof collection.extent == 'string' && validator.escape(collection['extent']).length > 0) {
		workset['extent'] = validator.escape(collection['extent']);
	}
	else if (Number.isInteger(collection.extent)) {
		workset['extent'] = collection['extent'];
	}
	else {
		logger.error("Missing extent");
		return undefined;
	}

	logger.debug("Checking for creator name");
	if ('workset_creator_name' in fields && typeof fields.workset_creator_name == 'string' && validator.escape(fields['workset_creator_name']).length > 0) {
		workset['primary_creator'] = validator.escape(fields['workset_creator_name']);
	}
	else {
		logger.error("Missing creator name");
		return undefined;
	}

	logger.debug("Checking for workset title");
	if ('htrc_workset_title' in fields && typeof fields.htrc_workset_title == 'string' && validator.escape(fields['htrc_workset_title']).length > 0) {
		workset['title'] = validator.escape(fields['htrc_workset_title']);
	}
	else if ('title' in collection && typeof collection.title == 'string' && validator.escape(collection['title']).length > 0) {
		workset['title'] = validator.escape(collection['title']);
	}
	else {
		logger.error("Missing workset_title");
		return undefined;
	}

	if ('abstract' in fields && typeof fields.abstract == 'string' && validator.escape(fields['abstract']).length > 0) {
		workset['abstract'] = validator.escape(fields['abstract']).replace(/\n/g,'');
	}
	else if ('description' in collection && typeof collection.description == 'string' && validator.escape(collection['description']).length > 0) {
		workset['abstract'] = validator.escape(collection['description']).replace(/\n/g,'');
	}
	else {
		logger.error("Missing description");
		return undefined;
	}

	logger.debug("Checking for manifest");
	if ('gathers' in collection && Array.isArray(collection.gathers)) {
		workset['gathers'] = collection['gathers'];
	}
	else {
		logger.error("Missing gathers");
		return undefined;
	}

/*
	OPTIONAL FIELDS
*/

	logger.debug("Looking for origin");
	if ('source_url' in fields && typeof fields.source_url == 'string' && validator.isURL(fields.source_url)) {
		workset['origin'] = fields.source_url;
	}
	
	logger.debug("Looking for additional creators");
	if ('additional_creator_name' in fields) {
		logger.info("additional_creator_name type: %s",typeof fields['additional_creator_name']);
		logger.info("additional_creator_name contents: %o",fields['additional_creator_name']);
	}

	logger.debug("Adding additional creators (without check for variable existing)");
	workset['additional_creators'] = []
	for (var index = 1; index < 10; index++) {
		if (('additional_creator_name'+index) in fields && typeof fields['additional_creator_name'+index] == 'string' && validator.escape(fields['additional_creator_name'+index]).length > 0) {
			workset['additional_creators'].push(validator.escape(fields['additional_creator_name'+index]));
		}
	}

	logger.debug("Looking for collection creator");
	if ('created' in collection && typeof collection.created == 'string' && validator.escape(collection['created']).length > 0 && collection['created'] != workset['primary_creator'] ) {
		workset['collection_creator'] = validator.escape(collection['created']);
	}

	logger.debug("Looking for research_motivation");
	if ('research_motivation' in fields && typeof fields.research_motivation == 'string' && validator.escape(fields['research_motivation']).length > 0) {
		workset['research_motivation'] = validator.escape(fields.research_motivation);
	}

	logger.debug("Looking for criteria");
	if ('criteria' in fields && typeof fields.criteria == 'string' && validator.escape(fields.criteria).length > 0) {
		workset['criteria'] = validator.escape(fields.criteria);
	}

	logger.debug("Built workset object: %o",workset);
	return workset;
}

function submitWorksetToVirtuoso(workset,res) {
	logger.info("Created workset object");

	var graph_url = '<' + config.get('Worksets.base') + '/graph/' + workset['id'] + '>';
	var target_url = '<' + config.get('Worksets.base') + '/wsid/' + workset['id'] + '>';

	var query = 'PREFIX rdf:	<http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n';
	query += 'PREFIX rdfs:	<http://www.w3.org/2000/01/rdf-schema#>\n';
	query += 'PREFIX ns1:	<http://wcsa.htrc.illinois.edu/>\n';
	query += 'PREFIX ns2:	<http://purl.org/dc/terms/>\n';
	query += 'PREFIX ns3:	<http://www.europeana.eu/schemas/edm/>\n';
	query += 'PREFIX fabio:	<http://purl.org/spar/fabio/>\n\n';

	query += 'INSERT INTO ' + graph_url + '\n';
	query += '{\n' + target_url + '	rdf:type	ns1:Workset ;\n';

	query += '\tns2:created\t"' + workset['created'] + '" ;\n';
	query += '\tns2:extent\t' + workset['extent'] + ' ;\n';

	query += '\tns2:creator\t<http://catalogdata.library.illinois.edu/lod/entities/htrc/user/' + workset['primary_creator'] + '> ;\n';

	if (workset['additional_creators'].length > 0) {
		for (var index = 0; index < workset['additional_creators'].length; index++) {
			query += '\tns2:creator\t"' + workset['additional_creators'][index] + '" ;\n';
		}
	}

	query += '\tns2:title\t"' + workset['title'] + '" ;\n';

	query += '\tns2:abstract\t"' + workset['abstract'] + '" ;\n';

	if ('research_motivation' in workset) {
		query += '\tns1:hasResearchMotivation\t"' + workset['research_motivation'] + '" ;\n';
	}

	if ('criteria' in workset) {
		query += '\tns1:hasCriterion\t"' + workset['criteria'] + '" ;\n';
	}

/*	Old language and temporal coverage code. Keeping for reference, will need to replace after data has been added to Virtuoso

	var language_index = 0;
	while ( 'language' + language_index.toString() in fields && fields['language' + language_index.toString()] != '') {
		query += '\tns2:language\t"' + fields['language' + language_index.toString()] + '" ;\n';
		language_index += 1;
	}

	var temporal_index = 0;
	while ('temporal_coverage' + temporal_index.toString() in fields && validator.escape(fields['temporal_coverage' + temporal_index.toString()]) != '') {
		query += '\tns2:temporal\t"' + validator.escape(fields['temporal_coverage' + temporal_index.toString()]) + '" ;\n';
		temporal_index += 1;
	}*/

	if ('origin' in workset) {
		query += '\tns2:isVersionOf\t<' + workset['origin'] + '> ;\n';
	}

	query += '\tns1:intendedForUse\t<http://example.org/htrc.algorithm> ;\n';
	query += '\tns1:hasVisibility\t"' + ( workset['private'] ? 'private' : 'public' ) + '" .\n';

	var max = workset['gathers'].length < 1000 ? workset['gathers'].length : 1000;
	for (var item = 0; item < max; item ++) {
		query += target_url + '\tns3:gathers\t<http://hdl.handle.net/2027/' + workset['gathers'][item]['htitem_id'] + '> .\n';
	}

	query += '};\n\n';

	if ('origin' in workset && 'collection_creator' in workset) {
		query += 'INSERT INTO ' + '<' + config.get('Worksets.base') + '/graph/collections>'; + '\n';
		query += '{\n<' + workset['origin'] + '>\tns2:creator\t<http://catalogdata.library.illinois.edu/lod/entities/ht/user/' + encodeURIComponent(workset['collection_creator']) + '> .\n';
		query += '};\n\n';
	}

	logger.info(query);
	logger.info("ABOUT TO SEND TURTLE FILE");
	logger.info("SENT TURTLE FILE");

	//Build collection
	needle.post(config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'),{
		'default-graph-uri': '',
		'query': query,
		'format': 'text/html'
	},{
		username: config.get('Read-Write_Endpoint.username'),
		password: config.get('Read-Write_Endpoint.password'),
		auth: 'digest'
	}, function (er,rs,bd) {
		if (er) {
			var errorStatus = {
				errorcode: -1
			};
			errorStatus.message = er.message;
			logger.error("ERROR: %o",errorStatus);
			res.end(JSON.stringify(errorStatus));
		}
		else {
			logger.info(bd);
			if (bd.indexOf("Virtuoso 37000 Error SP031: SPARQL: Internal error: The length of generated SQL text has exceeded 10000 lines of code") == 0) {
				var errorStatus = {
					errorcode: 413,
					message: "Collection too large to ingest"
				};
				logger.error("ERROR: %o",errorStatus);
				res.status(413).end(JSON.stringify(errorStatus));
			}
			else {
				logger.info("Created Workset");
				res.header("Location", target_url.replace('<','').replace('>',''),);
				res.status(201).end(JSON.stringify({
					result_title: workset['title'],
					result_extent: workset['extent'],
					result_url: target_url.replace('<','').replace('>',''),
					result_volumes: []
				}));

			}
		}
	});

	if (max < workset['gathers'].length) {
		logger.info("Ingesting into chunks");
		gathersPaging(workset,1000,graph_url,target_url);
	}

//	console.log("Created Workset");
}

export function submitWorkset(req,res) {
	res.header("Content-type", "application/json");

	logger.info("Request has Content-Type: %s",req.get('Content-Type'));
	logger.info("Body has type: %o",typeof req.body);
	logger.info("Reached submitWorkset: %o",req.body);

	var workset = buildWorksetObject(req.body);
	if (workset) {
		submitWorksetToVirtuoso(workset,res);
	}
	else {
		logger.error("Missing required field");
		var errorStatus = {
			errorcode: 400,
			message: "Missing required field"
		};
		res.status(400).end(JSON.stringify(errorStatus));
	}
}