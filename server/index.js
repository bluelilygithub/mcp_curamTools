'use strict';

const { createPlatform } = require('./platform/createPlatform');

const platform = createPlatform();

platform.start().catch((err) => {
  const logger = require('./utils/logger');
  logger.error('Failed to initialise platform — exiting', { error: err.message });
  process.exit(1);
});

module.exports = platform.app;
