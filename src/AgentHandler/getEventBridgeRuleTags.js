/* eslint-disable no-async-promise-executor */

// Copyright 2020 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');

const RETRY_LIMIT = 10;

const _tags = {};
module.exports = async ruleArn => {
  if (!(ruleArn in _tags)) {
    _tags[ruleArn] = new Promise(async (resolve, reject) => {
      const eventBridge = new AWS.EventBridge();

      let tags;
      for (let i = 0; i < RETRY_LIMIT; i++) {
        try {
          ({ Tags: tags } = await eventBridge.listTagsForResource({
            ResourceARN: ruleArn
          }).promise());

          break;
        } catch (err) {
          if (i === RETRY_LIMIT - 1) {
            reject(err);
            return;
          }

          if (err.code === 'ThrottlingException') {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 100));
          } else {
            reject(err);
            return;
          }
        }
      }

      // Remove reserved 'aws:*' tags
      resolve(tags.filter(tag => !tag.Key.startsWith('aws:')));
    });
  }

  return _tags[ruleArn];
};
