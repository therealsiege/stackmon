// Copyright 2018-2020 Stackery, Inc. All Rights Reserved.

const recordTypes = require('./recordTypes');
const certificate = require('./customResources/certificate');
const edgeFunction = require('./customResources/edgeFunction');

module.exports = async records => {
  await Promise.all(records.map(record => handleRecord(record)));
};

const handleRecord = async record => {
  if (record.eventSource !== 'aws:sqs') {
    throw new Error(`Unexpected record event source ${record.eventSource}`);
  }

  let provisionRecord;
  try {
    provisionRecord = JSON.parse(record.body);
  } catch (err) {
    throw new Error(`Failed to parse provision record body ${record.body}`);
  }

  const timestamp = Number(record.attributes.SetTimestamp);

  switch (provisionRecord.type) {
    case recordTypes.US_EAST_1_CERTIFICATE_CREATE:
    case recordTypes.US_EAST_1_CERTIFICATE_DELETE:
      await certificate.check(provisionRecord, timestamp);
      break;

    case recordTypes.LAMBDA_EDGE_FUNCTION_DELETE:
      await edgeFunction.check(provisionRecord, timestamp);
      break;

    default:
      throw new Error(`Unexpected provision check record type ${provisionRecord.type}`);
  }
};
