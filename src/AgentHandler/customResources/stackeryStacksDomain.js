// Copyright 2018 Stackery, Inc. All Rights Reserved.

const crypto = require('crypto');
const https = require('https');
const sendProvisionResponse = require('../sendProvisionResponse');
const awsAccountId = process.env.AWS_ACCOUNT_ID;
const externalId = process.env.EXTERNAL_ID;
const stackeryApi = process.env.STACKERY_API || 'api.stackery.io';

// Tell the Stackery API to provision a stackery-stacks.io domain for a CDN
module.exports.provision = async message => {
  switch (message.RequestType) {
    case 'Create':
      return createDomain(message);

    case 'Update':
      return updateDomain(message);

    case 'Delete':
      return deleteDomain(message);

    default:
      throw new Error(`Invalid CloudFormation custom resource RequestType '${message.RequestType}'`);
  }
};

const sendRequest = async (hostname, path, method, message) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method,
      port: 443
    };

    console.log(`Sending ${method} request to https://${hostname}${path} with payload ${JSON.stringify(message, null, 2)}`);

    const req = https.request(options);

    req.on('error', err => reject(new Error(`Error while sending response to CloudFormation: ${err.message}.`)));

    req.on('response', res => {
      if (res.statusCode === 204) {
        resolve();
      }

      res.on('closed', () => reject(new Error(`Bad response status (${res.statusCode}), connection to Stackery API closed while receiving error message.`)));

      // Drain response data even if we don't care about it
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));

      if (res.statusCode !== 204) {
        res.on('end', () => {
          const bodyJSON = Buffer.concat(chunks).toString();

          let message;
          try {
            const body = JSON.parse(bodyJSON);
            message = body.message;
          } catch (e) {
            reject(new Error(`Bad response status (${res.statusCode}), failed to parse Stackery API error message.`));
          }

          reject(new Error(`${message}.`));
        });
      }
    });

    req.end(JSON.stringify(message));
  });
};

const digest = (message, timestamp) => {
  return crypto.createHmac('sha256', `${externalId}:${timestamp}`).update(message).digest('base64');
};

const createDomain = async message => {
  const request = {
    awsAccountId,
    action: 'CREATE',
    type: message.ResourceType,
    properties: message.ResourceProperties,
    timestamp: Date.now()
  };

  const requestMessage = {
    request,
    digest: digest(JSON.stringify(request), request.timestamp)
  };

  try {
    await sendRequest(stackeryApi, '/account/awsprovision', 'POST', requestMessage);
  } catch (err) {
    err.message = `Failed to create ${request.properties.SubdomainName}.stackery-stacks.io domain: ${err.message}`;
    throw err;
  }

  await sendProvisionResponse(request.properties.SubdomainName, null, 'SUCCESS', message);
};

const updateDomain = async message => {
  const request = {
    awsAccountId,
    action: 'UPDATE',
    type: message.ResourceType,
    oldProperties: message.OldResourceProperties,
    properties: message.ResourceProperties,
    timestamp: Date.now()
  };

  const requestMessage = {
    request,
    digest: digest(JSON.stringify(request), request.timestamp)
  };

  try {
    await sendRequest(stackeryApi, '/account/awsprovision', 'POST', requestMessage);
  } catch (err) {
    err.message = `Failed to update ${request.oldProperties.SubdomainName}.stackery-stacks.io domain: ${err.message}`;
    throw err;
  }

  await sendProvisionResponse(request.properties.SubdomainName, null, 'SUCCESS', message);
};

const deleteDomain = async message => {
  const request = {
    awsAccountId,
    action: 'DELETE',
    type: message.ResourceType,
    properties: message.ResourceProperties,
    timestamp: Date.now()
  };

  const requestMessage = {
    request,
    digest: digest(JSON.stringify(request), request.timestamp)
  };

  try {
    await sendRequest(stackeryApi, '/account/awsprovision', 'POST', requestMessage);
  } catch (err) {
    err.message = `Failed to delete ${request.properties.SubdomainName}.stackery-stacks.io domain: ${err.message}`;
    throw err;
  }

  await sendProvisionResponse(request.properties.SubdomainName, null, 'SUCCESS', message);
};
