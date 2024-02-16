#!/usr/bin/env node

const fs = require('fs/promises');

const checker = require('license-checker-rseidelsohn');
const { Octokit } = require("@octokit/rest");
const fetch = require('node-fetch');

const LICENSE_FILENAME_RE = /(licen[cs]e|copying)/i;
const REPO_RE = /github.com\/([^/]+)\/([^/]+)/;

const STACKERY_LICENSE = `All components of this product, unless otherwise stated below, are
Copyright © 2019-2021 Stackery, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

`;

const { githubAuthToken: auth } = require('yargs')
  .default(process.argv.slice(2))
  .command('* <githubAuthToken>', 'Generate licenses.txt', yargs => yargs
    .positional('githubAuthToken', {
      description: 'GitHub personal access token',
      type: 'string'
    })
    .strict()
  )
  .help()
  .argv;

const octokit = new Octokit({ auth });

const STATIC_LICENSES = [
  'json-schema@0.2.3' // We choose BSD over AFL and include it manually
];

checker.init({
  start: '..',
  production: true,
  boolean: false,
  unknown: true,
  excludePackages: [
    'stackery'
  ]
}, async (err, info) => {
  const fullInfo = await Promise.all(Object.entries(info).map(async ([module, modInfo]) => {
    if (!LICENSE_FILENAME_RE.test(modInfo.licenseFile)) {
      delete modInfo.licenseFile;

      const [_, owner, repo] = modInfo.repository.match(REPO_RE);

      const { data: files } = await octokit.rest.repos.getContent({ owner, repo });

      const file = files.find(file => LICENSE_FILENAME_RE.test(file.path));

      const licenseURL = file ? file.download_url : undefined;

      return {
        module,
        licenseURL,
        ...modInfo
      };
    } else {
      return {
        module,
        ...modInfo
      }
    }
  }));

  const licensesFile = await fs.open('../LICENSE', 'w', 0o660);

  await fs.writeFile(licensesFile, STACKERY_LICENSE);

  for (const module of fullInfo) {
    let text;

    if (STATIC_LICENSES.includes(module.module)) {
      continue;
    } else if (module.licenseFile) {
      text = await fs.readFile(module.licenseFile);
    } else if (module.licenseURL) {
      text = await (await fetch(module.licenseURL)).text();
    } else {
      throw new Error(`UNKNOWN LICENSE: ${module.module} (${module.repository})`);
    }

    const ack = `${module.module}\n${text}\n\n`;

    await fs.writeFile(licensesFile, ack);
  }

  const staticLicensesText = await fs.readFile('static-licenses.txt');

  await fs.writeFile(licensesFile, staticLicensesText);

  await licensesFile.close();
});