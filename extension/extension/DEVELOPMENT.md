### Development

#### Testing against a different environment

Suppose you want the Stackery CLI to interact with a different environment than prod. The extension supports this via a few undocumented settings:

1. Open the VSCode settings editor (either for the global settings or for the workspace you are testing with).
1. The slick visual editor is shown at first, but we can't use it to set undocumented settings. Instead, click on the icon at the top right corner of the settings editor pane that looks like `{}`. This will open the pure JSON settings editor.
1. Add the following settings:
    * `"stackery._env": <env>` (May be `dev`, to hit localhost, or any other environment)
    * `"stackery._userPoolId": <user pool ID>` (Only needed if you need to test Stackery login through the extension)
    * `"stackery._userPoolClientId": <user pool client ID>` (Only needed if you need to test Stackery login through the extension)

#### Sharing pre-release extension packages

First, when sharing pre-release extensions, try to remember to bump the version number (even if it's just the minor version), but append a beta version (e.g. `-beta.0`). This will help differentiate installed extensions between released and pre-released versions.

The extension can be packaged by doing the following:

1. Install the `vsce` tool: `$ npm install -g vsce`.
1. Package the extension: `$ vsce package`. This will create a file named `stackery-<version>.vsix` in the top-level directory.
1. Share the package.
1. Install the package using: `code --install-extension <package>`.

### Release

Acquire a personal access token and login using vsce if needed: https://code.visualstudio.com/api/working-with-extensions/publishing-extension. If you need access to the "stackery" project in Azure DevOps reach out to Chase to be added to the account.

1. Clone / check out a clean copy of the `master` branch
1. Determine next version, depending on whether this is a patch, minor, or major version increase
1. Update CHANGELOG.md (follow [Keep a Changelog](http://keepachangelog.com/) recommendations on how to structure this entries.)
1. Run `vsce publish [major|minor|patch]`.
    
    **WARNING:** If this fails, make sure to revert any changes it made in package.json or elsewhere before re-running the command. Otherwise, it will double-increment the version before publishing.
    
1. Push the new commit and release tag to the repo: `git push origin HEAD --tags`
