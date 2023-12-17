// Copyright 2018 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const sendProvisionResponse = require('../../sendProvisionResponse');

const RDS_ARN_RE = /^arn:aws:rds:([^:]+):[^:]+:(db|cluster):(.*)$/;
module.exports = async (message) => {
  const data = message.ResourceProperties.Data;

  if (typeof data !== 'string') {
    throw new Error('Invalid existing database data: value must be a string');
  }

  let attributes;
  let ref;

  const arnMatch = data.match(RDS_ARN_RE);
  if (arnMatch) {
    ref = arnMatch[3];
    attributes = await describeDB(arnMatch[1], arnMatch[2], ref, data);
  } else {
    ref = data;

    const [address, port] = data.split(':');

    attributes = {
      'Endpoint.Address': address,
      'Endpoint.Port': port
    };
  }

  // We can't determine the root user Secrets Manager secret; supply an obviously invalid one.
  attributes.RootUserSecret = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:invalid';

  await sendProvisionResponse(ref, attributes, 'SUCCESS', message);
};

async function describeDB (region, type, id, arn) {
  const rds = new AWS.RDS({ region });

  // If the DB doesn't exist these will throw an error with a decent message
  if (type === 'cluster') {
    const { DBClusters } = await rds.describeDBClusters({
      DBClusterIdentifier: id
    }).promise();

    return {
      'Endpoint.Address': DBClusters[0].Endpoint,
      'Endpoint.Port': DBClusters[0].Port,
      'ReadEndpoint.Address': DBClusters[0].ReaderEndpoint
    };
  } else {
    const { DBInstances } = await rds.describeDBInstances({
      DBInstanceIdentifier: id
    }).promise();

    return {
      'Endpoint.Address': DBInstances[0].Endpoint.Address,
      'Endpoint.Port': DBInstances[0].Endpoint.Port
    };
  }
}
