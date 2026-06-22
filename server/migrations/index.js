'use strict';

/**
 * Ordered migration registry. Add new files here — never reorder existing ids.
 */
module.exports = [
  require('./001_platform_schema_patches'),
  require('./002_embedding_vector_dimensions'),
  require('./003_system_settings_data_patches'),
  require('./004_organizations_description'),
];
