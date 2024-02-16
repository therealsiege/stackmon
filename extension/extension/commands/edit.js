/*
Copyright 2019 Stackery, Inc.

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
*/

const path = require('path');

const vscode = require('vscode');

const { setup, startDevServer } = require('./setup');
const stackeryEnv = require('../stackeryEnv');

let devServers;

module.exports = context => async uri => {
  uri = uri || vscode.window.activeTextEditor.document.uri;

  const globalState = context.globalState;

  if (!globalState.get('localStorage')) {
    await globalState.update('localStorage', {});
  }

  let localStorage = globalState.get('localStorage');
  if (!devServers) {
    devServers = await setup();
  }

  // Is the template within some workspace folder?
  let within = false;
  let templatePath;

  for (const folder of vscode.workspace.workspaceFolders) {
    templatePath = path.relative(folder.uri.fsPath, uri.fsPath);
    if (!templatePath.startsWith('..')) {
      within = true;
      break;
    }
  }
  if (!within) {
    vscode.window.showErrorMessage('The template must reside within the current VS Code workspace. Please open a workspace that includes the template in order to edit it.', { modal: true });
    return;
  }

  let devServer;
  for (const server of devServers) {
    const relativePath = path.relative(server.folder, uri.fsPath);
    if (!relativePath.startsWith('..')) {
      devServer = server;
      break;
    }
  }

  // If there's no dev server for this workspace folder, create one
  if (!devServer) {
    devServer = await vscode.windows.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Loading project files....'
    },
    progress => {
      progress.report({ increment: 33 });
      return startDevServer(path.dirname(uri.fsPath));
    });
    devServers.push(devServer);
  }

  const panel = vscode.window.createWebviewPanel(
    'stackery.edit',
    path.basename(uri.path),
    vscode.ViewColumn.One,
    {
      retainContextWhenHidden: true,
      enableScripts: true,
      localResourceRoots: []
    }
  );

  panel.iconPath = {
    light: vscode.Uri.file(path.join(context.extensionPath, 'media', 'stackery-navy.svg')),
    dark: vscode.Uri.file(path.join(context.extensionPath, 'media', 'stackery-teal.svg'))
  };

  const templateDir = path.relative(devServer.folder, path.dirname(uri.fsPath));
  let location = editorURL() + `?templatepath=${encodeURIComponent(templatePath)}&templatedir=${encodeURIComponent(templateDir)}&port=${devServer.port}&secret=${devServer.secret}`;

  if (Object.keys(localStorage).length > 0) {
    location += `&localstorage=${encodeURIComponent(JSON.stringify(localStorage))}`;
  }

  panel.webview.html = getHtmlForWebview(panel.webview, location);

  panel.webview.onDidReceiveMessage(async message => {
    switch (message.type) {
      case 'localStorage.setItem':
        localStorage[message.key] = message.value;
        await globalState.update('localStorage', localStorage);
        break;

      case 'localStorage.removeItem':
        delete localStorage[message.key];
        await globalState.update('localStorage', localStorage);
        break;

      case 'localStorage.clear':
        await globalState.update('localStorage', {});
        localStorage = globalState.get('localStorage');
        break;

      case 'vscode.env.openExternal':
        await vscode.env.openExternal(message.uri);
        break;

      default:
        console.warn(`stackery: Received unknown message type ${message.type} from extension webview`);
        break;
    }
  });
};

const EDITOR_PATH = '/local';
const editorURL = () => {
  const env = stackeryEnv()._STACKERY_ENV;

  switch (env) {
    case 'dev':
      return `http://localhost:3002${EDITOR_PATH}`;

    case 'prod':
    case undefined:
      return `https://app.stackery.io${EDITOR_PATH}`;

    default:
      return `https://${env}-app.stackery.io${EDITOR_PATH}`;
  }
};

const getHtmlForWebview = (webview, location) => (
  `<!DOCTYPE html>
    <html lang="en" style="width: 100%; height: 100%;">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; frame-src http://localhost:* https://*.stackery.io; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="width: 100%; height: 100%; margin: 0; padding: 0;">
        <iframe frameborder="0" width="100%" height="100%" src=${location} />
      </body>
  </html>`
);
