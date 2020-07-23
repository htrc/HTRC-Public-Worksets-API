//reading file system / file
var fs = require("fs");
//var http = require('http');
var request = require("request");
//Library to handle forms
var formidable = require("formidable");
//Library for input sanitation
var sanitizer = require('validator');
//uuid library
const uuidv1 = require('uuid/v1');
//config library
var config = require('config');
//ajv library
var Ajv = require('ajv');
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

function extractCollectionIDFromURL(url) {
	return url.substring(url.indexOf('c=')+2);
}

function addPageSynchronously(query_index,queries) {
	request({
		method: 'POST',
		uri: config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'),
		port: config.get('Read-Write_Endpoint.port'),
		form: {
			'default-graph-uri': '',
			'query': queries[query_index],
			'format': 'text/html'
		},
		auth: {
			user: config.get('Read-Write_Endpoint.username'),
			password: config.get('Read-Write_Endpoint.password'),
			sendImmediately: false
		},
		headers: {
			'Content-Type': 'application/x-www-form-unencoded',
		}
	}, function (er,rs,bd) {
		if (er) {
			console.log("ERROR IN ADDING VOLUMES TO WORKSET: %o",er)
		}
		else {
			if (query_index+1 < queries.length) {
				console.log("Added chunk of 1000 volumes");
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

	queries = []

	for (var volume_counter = page_size; volume_counter < workset['gathers'].length; volume_counter++) {
		if (volume_counter % page_size == 0) {
			var new_query = base_text;
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

	console.log("Validating user input...");
	if ('source_data' in fields && validate(fields.source_data)) {
		var collection = fields.source_data;
	}
	else {
		console.log("Missing source_data");
		return undefined;
	}
	console.log("Validation successful");

	workset['id'] = uuidv1();

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

	if ('private_workset' in fields) {
		workset['private'] = (fields.private_workset == true);
		console.log("Private workset? %o",fields.private_workset == true);
	}
	else {
		return undefined;
	}

	if ('extent' in collection && typeof collection.extent == 'string' && sanitizer.escape(collection['extent']).length > 0) {
		workset['extent'] = sanitizer.escape(collection['extent']);
	}
	else if (Number.isInteger(collection.extent)) {
		workset['extent'] = collection['extent'];
	}
	else {
		console.log("Missing extent");
		return undefined;
	}

	if ('workset_creator_name' in fields && typeof fields.workset_creator_name == 'string' && sanitizer.escape(fields['workset_creator_name']).length > 0) {
		workset['primary_creator'] = sanitizer.escape(fields['workset_creator_name']);
	}
	else {
		console.log("Missing creator name");
		return undefined;
	}

	if ('htrc_workset_title' in fields && typeof fields.htrc_workset_title == 'string' && sanitizer.escape(fields['htrc_workset_title']).length > 0) {
		workset['title'] = sanitizer.escape(fields['htrc_workset_title']);
	}
	else if ('title' in collection && typeof collection.title == 'string' && sanitizer.escape(collection['title']).length > 0) {
		workset['title'] = sanitizer.escape(collection['title']);
	}
	else {
		console.log("Missing workset_title");
		return undefined;
	}

	if ('abstract' in fields && typeof fields.abstract == 'string' && sanitizer.escape(fields['abstract']).length > 0) {
		workset['abstract'] = sanitizer.escape(fields['abstract']).replace(/\n/g,'');
	}
	else if ('description' in collection && typeof collection.description == 'string' && sanitizer.escape(collection['description']).length > 0) {
		workset['abstract'] = sanitizer.escape(collection['description']).replace(/\n/g,'');
	}
	else {
		console.log("Missing description");
		return undefined;
	}

	if ('gathers' in collection && Array.isArray(collection.gathers)) {
		workset['gathers'] = collection['gathers'];
	}
	else {
		console.log("Missing gathers");
		return undefined;
	}

/*
	OPTIONAL FIELDS
*/

	if ('source_url' in fields && typeof fields.source_url == 'string' && sanitizer.isURL(fields.source_url)) {
		workset['origin'] = fields.source_url;
	}
	
	if ('additional_creator_name' in fields) {
		console.log("additional_creator_name type: %s",typeof fields['additional_creator_name']);
		console.log("additional_creator_name contents: %o",fields['additional_creator_name']);
	}

	workset['additional_creators'] = []
	for (var index = 1; index < 10; index++) {
		if (('additional_creator_name'+index) in fields && typeof fields['additional_creator_name'+index] == 'string' && sanitizer.escape(fields['additional_creator_name'+index]).length > 0) {
			workset['additional_creators'].push(sanitizer.escape(fields['additional_creator_name'+index]));
		}
	}

	if ('created' in collection && typeof collection.created == 'string' && sanitizer.escape(collection['created']).length > 0 && collection['created'] != workset['primary_creator'] ) {
		workset['collection_creator'] = sanitizer.escape(collection['created']);
	}

	if ('research_motivation' in fields && typeof fields.research_motivation == 'string' && sanitizer.escape(fields['research_motivation']).length > 0) {
		workset['research_motivation'] = sanitizer.escape(fields.research_motivation);
	}

	if ('criteria' in fields && typeof fields.criteria == 'string' && sanitizer.escape(fields.criteria).length > 0) {
		workset['criteria'] = sanitizer.escape(fields.criteria);
	}

	return workset;
}

function submitWorksetToVirtuoso(workset,res) {
	console.log("Workset from portal: %o",workset);

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
	while ('temporal_coverage' + temporal_index.toString() in fields && sanitizer.escape(fields['temporal_coverage' + temporal_index.toString()]) != '') {
		query += '\tns2:temporal\t"' + sanitizer.escape(fields['temporal_coverage' + temporal_index.toString()]) + '" ;\n';
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

	console.log(query);
	console.log("ABOUT TO SEND TURTLE FILE");

	//Build collection
	request({
		method: 'POST',
		uri: config.get('Read-Write_Endpoint.domain') + ':' + config.get('Read-Write_Endpoint.port') + '/' + config.get('Read-Write_Endpoint.path'),
		port: config.get('Read-Write_Endpoint.port'),
		form: {
			'default-graph-uri': '',
			'query': query,
			'format': 'text/html'
		},
		auth: {
			user: config.get('Read-Write_Endpoint.username'),
			password: config.get('Read-Write_Endpoint.password'),
			sendImmediately: false
		},
		headers: {
			'Content-Type': 'application/x-www-form-unencoded',
		}
	}, function (er,rs,bd) {
		if (er) {
			var errorStatus = {
				errorcode: -1
			};
			errorStatus.message = er.message;
			res.end(JSON.stringify(errorStatus));
		}
		else {
			console.log(bd);
			if (bd.indexOf("Virtuoso 37000 Error SP031: SPARQL: Internal error: The length of generated SQL text has exceeded 10000 lines of code") == 0) {
				var errorStatus = {
					errorcode: 413,
					message: "Collection too large to ingest"
				};
				res.status(413).end(JSON.stringify(errorStatus));
			}
			else {
				var pd_query = 'prefix dcterms: <http://purl.org/dc/terms/>\nprefix edm: <http://www.europeana.eu/schemas/edm/>\nprefix htrc: <http://wcsa.htrc.illinois.edu/> \nprefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nprefix xsd: <http://www.w3.org/2001/XMLSchema#>\n\nCONSTRUCT {\n  ?wsid\n	  rdf:type htrc:Workset ;\n	  dcterms:title ?title ;\n	  dcterms:creator ?cre ; \n	  dcterms:created ?dat ;\n	  dcterms:extent  ?ext ;\n	  edm:gathers ?vols .} \n\nwhere {\n  ?wsid \n	  rdf:type htrc:Workset ;\n	  dcterms:title ?title ;\n	  dcterms:creator ?cre ; \n	  dcterms:created ?dat ;\n	  dcterms:extent  ?ext ;\n	  edm:gathers ?vols . \n	  { select ?vols\n				where {\n				  ?wsid edm:gathers ?vols.\n				  ?vols dcterms:accessRights ?ar\n				  filter ( ?ar = "pd" ) .\n				}\n			  }\n  VALUES ( ?wsid ) \n	 { \n	   ( ' + target_url + ' ) \n	 }	  	   \n}';
				
				request({
					method: 'POST',
					uri: config.get('Read-Only_Endpoint.domain') + '/' + config.get('Read-Only_Endpoint.path'),
					port: config.get('Read-Only_Endpoint.port'),
					form: {
						'default-graph-uri': '',
						'query': pd_query,
						'format': 'text/html'
					},
					headers: {
						'Content-Type': 'application/x-www-form-unencoded',
					}
				}, function (e,r,b) {
					if (e) {
						var errorStatus = {
							errorcode: -1
						};
						errorStatus.message = e.message;
						res.end(JSON.stringify(errorStatus));
					}
					else {
						console.log("GOT PD WORKSET");

						var start_index = b.indexOf('n4:gathers');
						var shorter_string = b.substring(start_index);
						console.log("Gathers substring: %s",shorter_string);
						var slices = shorter_string.split('"');
						console.log("Gathers slices: %o",slices);
						var pd_volumes = [];
						for (var i = 0; i < slices.length; i++) {
							if (slices[i].substring(0,27) == 'http://hdl.handle.net/2027/') {
								pd_volumes.push(slices[i]);
							}
						}
						console.log("Gathers volumes: %o",pd_volumes);

						res.header("Location", target_url.replace('<','').replace('>',''),);
						res.status(201).end(JSON.stringify({
							result_title: workset['title'],
							result_extent: workset['extent'],
							result_url: target_url.replace('<','').replace('>',''),
							result_volumes: pd_volumes
						}));
					}
				});
			}
		}
	});

	if (max < workset['gathers'].length) {
		console.log("Ingesting into chunks");
		gathersPaging(workset,1000,graph_url,target_url);
	}

	console.log("Created Workset");
}

exports.submitWorkset = function(req,res) {
	res.header("Content-type", "application/json");

	console.log("Request has Content-Type: ",req.get('Content-Type'));
	console.log("Body has type: %o",typeof req.body);
	console.log("Reached submitWorkset: %o",req.body);

	var workset = buildWorksetObject(req.body);
	if (workset) {
		submitWorksetToVirtuoso(workset,res);
	}
	else {
		console.log("Missing required field");
		var errorStatus = {
			errorcode: 400,
			message: "Missing required field"
		};
		res.status(400).end(JSON.stringify(errorStatus));
	}
}