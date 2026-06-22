'use strict';

function localServer(filePath, requiredEnv = []) {
  const process = require('process');
  return {
    transportType: 'stdio',
    endpointUrl: null,
    config: {
      command: process.execPath,
      args: [filePath],
      requiredEnv,
    },
  };
}

module.exports = { localServer };
