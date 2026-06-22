'use strict';

/**
 * Agent manifest — merged registry for backward compatibility.
 * Source of truth per app: apps/diamond-plate/agentManifest.js, apps/engineering/agentManifest.js
 */

const diamondPlateAgents = require('../apps/diamond-plate/agentManifest');
const engineeringAgents = require('../apps/engineering/agentManifest');

module.exports = [...diamondPlateAgents, ...engineeringAgents];
