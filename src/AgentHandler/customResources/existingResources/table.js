// Copyright 2018 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const sendProvisionResponse = require('../../sendProvisionResponse');

const TABLE_ARN_RE = /^arn:[^:]+:dynamodb:([^:]+):[0-9]+:table\/(.+)$/;
module.exports = async (message) => {
  const arn = message.ResourceProperties.Data;

  if (typeof arn !== 'string') {
    throw new Error(`Invalid existing DynamoDB Table data: data must be an AWS ARN string`);
  }

  let region;
  let tableName;
  try {
    let _; // eslint-disable-line no-unused-vars
    [ _, region, tableName ] = arn.match(TABLE_ARN_RE);
  } catch (err) {
    throw new Error(`Invalid existing DynamoDB Table data: data is not a valid DynamoDB Table ARN (${arn})`);
  }

  const dynamodb = new AWS.DynamoDB({ region });

  let streamArn;
  try {
    const { Table } = await dynamodb.describeTable({ TableName: tableName }).promise();

    if (Table.StreamSpecification && Table.StreamSpecification.StreamEnabled) {
      streamArn = Table.LatestStreamArn;
    }
  } catch (err) {
    throw new Error(`Error while fetching existing DynamoDB Table stream specification for table ${tableName}: ${err.message}`);
  }

  const attributes = {
    Arn: arn,
    StreamArn: streamArn
  };

  await sendProvisionResponse(tableName, attributes, 'SUCCESS', message);
};
