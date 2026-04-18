/**
 * test-mcp-resources.js — Test script to verify MCP resource support
 * 
 * This script tests that the Google Ads and WordPress MCP servers
 * correctly implement resource discovery and access.
 */

const { spawn } = require('child_process');
const readline = require('readline');

// Test configuration
const servers = [
  {
    name: 'Google Ads',
    command: 'node',
    args: ['server/mcp-servers/google-ads.js'],
    expectedResources: [
      'google-ads://campaigns/current',
      'google-ads://keywords/top-performing',
      'google-ads://budget/pacing-summary',
    ],
  },
  {
    name: 'WordPress',
    command: 'node',
    args: ['server/mcp-servers/wordpress.js'],
    expectedResources: [
      'wordpress://enquiries/recent',
      'wordpress://enquiries/device-breakdown',
      'wordpress://enquiries/utm-sources',
    ],
  },
];

async function testServer(serverConfig) {
  console.log(`\n=== Testing ${serverConfig.name} MCP Server ===`);
  
  return new Promise((resolve, reject) => {
    const child = spawn(serverConfig.command, serverConfig.args, {
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = readline.createInterface({ input: child.stdout });
    let buffer = '';
    let initialized = false;
    let testResults = {
      name: serverConfig.name,
      resourcesListed: false,
      resourcesCount: 0,
      resourcesTested: 0,
      errors: [],
    };

    // Send initialize message
    const initMsg = {
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    };
    child.stdin.write(JSON.stringify(initMsg) + '\n');

    rl.on('line', async (line) => {
      if (!line.trim()) return;

      try {
        const msg = JSON.parse(line);
        
        // Handle initialize response
        if (msg.id === 'init' && msg.result) {
          console.log(`  ✓ Initialized successfully`);
          console.log(`  Server info: ${msg.result.serverInfo.name} v${msg.result.serverInfo.version}`);
          
          // Check if resources capability is advertised
          if (msg.result.capabilities.resources) {
            console.log(`  ✓ Resources capability advertised`);
            
            // Request resources list
            const listMsg = {
              jsonrpc: '2.0',
              id: 'list-resources',
              method: 'resources/list',
              params: {},
            };
            child.stdin.write(JSON.stringify(listMsg) + '\n');
          } else {
            testResults.errors.push('Resources capability not advertised');
            console.log(`  ✗ Resources capability NOT advertised`);
            child.stdin.end();
            child.kill();
            resolve(testResults);
          }
        }
        
        // Handle resources list response
        if (msg.id === 'list-resources' && msg.result) {
          const resources = msg.result.resources || [];
          testResults.resourcesListed = true;
          testResults.resourcesCount = resources.length;
          
          console.log(`  ✓ Resources listed: ${resources.length} resources found`);
          
          // Check expected resources
          const resourceUris = resources.map(r => r.uri);
          for (const expectedUri of serverConfig.expectedResources) {
            if (resourceUris.includes(expectedUri)) {
              console.log(`    ✓ Expected resource: ${expectedUri}`);
              
              // Test reading this resource
              const readMsg = {
                jsonrpc: '2.0',
                id: `read-${expectedUri.replace(/[^a-zA-Z0-9]/g, '-')}`,
                method: 'resources/read',
                params: { uri: expectedUri },
              };
              child.stdin.write(JSON.stringify(readMsg) + '\n');
            } else {
              console.log(`    ✗ Missing expected resource: ${expectedUri}`);
              testResults.errors.push(`Missing expected resource: ${expectedUri}`);
            }
          }
        }
        
        // Handle resource read responses
        if (msg.id && msg.id.startsWith('read-') && msg.result) {
          testResults.resourcesTested++;
          const uri = msg.id.replace('read-', '').replace(/-/g, '://').replace(/-/g, '/');
          console.log(`    ✓ Resource read successful: ${uri}`);
          
          // Check response structure
          if (msg.result.contents && Array.isArray(msg.result.contents)) {
            console.log(`      Content type: ${msg.result.contents[0]?.mimeType || 'unknown'}`);
          }
          
          // If we've tested all resources, end the test
          if (testResults.resourcesTested === serverConfig.expectedResources.length) {
            console.log(`  ✓ All resources tested successfully`);
            child.stdin.end();
            child.kill();
            resolve(testResults);
          }
        }
        
        // Handle errors
        if (msg.error) {
          console.log(`  ✗ Error: ${msg.error.message}`);
          testResults.errors.push(`RPC error: ${msg.error.message}`);
        }
        
      } catch (err) {
        console.log(`  ✗ Parse error: ${err.message}`);
        testResults.errors.push(`Parse error: ${err.message}`);
      }
    });

    child.stderr.on('data', (data) => {
      console.log(`  ⚠ Stderr: ${data.toString().trim()}`);
    });

    child.on('error', (err) => {
      console.log(`  ✗ Process error: ${err.message}`);
      testResults.errors.push(`Process error: ${err.message}`);
      reject(testResults);
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.log(`  ✗ Process exited with code ${code}`);
        testResults.errors.push(`Process exited with code ${code}`);
      }
      // Don't reject here - let the test complete
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      console.log(`  ✗ Test timeout`);
      testResults.errors.push('Test timeout');
      child.stdin.end();
      child.kill();
      resolve(testResults);
    }, 10000);
  });
}

async function runAllTests() {
  console.log('=== MCP Resource Support Test ===');
  console.log('Testing resource discovery and access in MCP servers...\n');
  
  const results = [];
  
  for (const server of servers) {
    try {
      const result = await testServer(server);
      results.push(result);
    } catch (err) {
      console.log(`  ✗ Test failed: ${err.message}`);
      results.push({
        name: server.name,
        resourcesListed: false,
        resourcesCount: 0,
        resourcesTested: 0,
        errors: [`Test failed: ${err.message}`],
      });
    }
  }
  
  // Summary
  console.log('\n=== Test Summary ===');
  let passed = 0;
  let failed = 0;
  
  for (const result of results) {
    if (result.errors.length === 0) {
      console.log(`✓ ${result.name}: PASSED`);
      console.log(`  Resources listed: ${result.resourcesListed}`);
      console.log(`  Resources count: ${result.resourcesCount}`);
      console.log(`  Resources tested: ${result.resourcesTested}`);
      passed++;
    } else {
      console.log(`✗ ${result.name}: FAILED`);
      console.log(`  Errors: ${result.errors.join(', ')}`);
      failed++;
    }
  }
  
  console.log(`\nTotal: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n✓ All tests passed! MCP resource support is working correctly.');
    process.exit(0);
  }
}

// Run tests
runAllTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});