/* eslint-disable no-async-promise-executor */

// Copyright 2020 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');

const RETRY_LIMIT = 10;

const _tags = {};
module.exports = async (functionName, region = process.env.AWS_REGION) => {
  const arn = `arn:aws:lambda:${region}:${process.env.AWS_ACCOUNT_ID}:function:${functionName}`;

  if (!(arn in _tags)) {
    _tags[arn] = new Promise(async (resolve, reject) => {
      const lambda = new AWS.Lambda({ region });

      let tags;
      for (let i = 0; i < RETRY_LIMIT; i++) {
        try {
          ({ Tags: tags } = await lambda.listTags({
            Resource: arn
          }).promise());

          break;
        } catch (err) {
          if (i === RETRY_LIMIT - 1) {
            reject(new Error(`Error while trying to get lambda function tags. Error: ${err.message} (${err.code})`));
            return;
          }

          if (err.code === 'TooManyRequestsException') {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
          } else {
            reject(new Error(`Error while trying to get lambda function tags. Error: ${err.message} (${err.code})`));
            return;
          }
        }
      }

      // Remove reserved 'aws:*' tags
      for (const key of Object.keys(tags)) {
        if (key.startsWith('aws:')) {
          delete tags[key];
        }
      }

      resolve(tags);
    });
  }

  return _tags[arn];
};
