// Copyright 2019 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const sendProvisionResponse = require('../../sendProvisionResponse');

const RDS_ARN_RE = /^arn:aws:rds:([^:]+):[^:]+:cluster:(.*)$/;
module.exports = async (message) => {
  const arn = message.ResourceProperties.Data;

  if (typeof arn !== 'string') {
    throw new Error(`Invalid existing database data: value must be an AWS ARN string`);
  }

  let attributes;
  let ref;

  const arnMatch = arn.match(RDS_ARN_RE);
  if (!arnMatch) {
    throw new Error(`Invalid existing Neptune data: not a valid Neptune ARN (${arn})`);
  }

  ref = arnMatch[2];
  attributes = await describeNeptune(arnMatch[1], ref, arn);

  await sendProvisionResponse(ref, attributes, 'SUCCESS', message);
};

async function describeNeptune (region, id, arn) {
  const neptune = new AWS.Neptune({ region });

  // If the DB doesn't exist these will throw an error with a decent message
  const { DBClusters } = await neptune.describeDBClusters({
    DBClusterIdentifier: id
  }).promise();

  return {
    ClusterId: DBClusters[0].DbClusterResourceId,
    Endpoint: DBClusters[0].Endpoint,
    Port: DBClusters[0].Port,
    ReadEndpoint: DBClusters[0].ReaderEndpoint
  };
}
