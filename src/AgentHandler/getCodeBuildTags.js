/* eslint-disable no-async-promise-executor */

// Copyright 2020 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');

const RETRY_LIMIT = 10;

const _tags = {};
module.exports = async projectName => {
  if (!(projectName in _tags)) {
    _tags[projectName] = new Promise(async (resolve, reject) => {
      const CodeBuild = new AWS.CodeBuild();

      let projects;
      for (let i = 0; i < RETRY_LIMIT; i++) {
        try {
          ({ projects } = await CodeBuild.batchGetProjects({
            names: [projectName]
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
      resolve(projects[0].tags.filter(tag => !tag.key.startsWith('aws:')));
    });
  }

  return _tags[projectName];
};
