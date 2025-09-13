// Debug script to test API connection from browser console
// Copy and paste this in the browser console on the extension's background page

async function testAPIConnection() {
  console.log('=== Qshing API Connection Test ===');

  try {
    // Test 1: Basic API connection
    console.log('1. Testing basic API connection...');

    const testUrl = 'https://example.com';
    const requestBody = JSON.stringify({ url: testUrl });

    console.log(
      'Request URL: https://api.bnbong.xyz/phishing-detection/analyze'
    );
    console.log(`Request Body: ${requestBody}`);

    const response = await fetch(
      'https://api.bnbong.xyz/phishing-detection/analyze',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'Wegis-Extension/1.0.0'
        },
        body: requestBody,
        mode: 'cors',
        credentials: 'omit'
      }
    );

    console.log(`Response Status: ${response.status}`);
    console.log('Response Headers:', [...response.headers.entries()]);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error: ${response.status} - ${errorText}`);
      return false;
    }

    const data = await response.json();
    console.log('API Response Data:', data);

    // Test 2: Check if response has expected structure
    console.log('2. Validating response structure...');

    if (data && data.data && typeof data.data.result === 'boolean') {
      console.log('✅ Response structure is valid');
      console.log(`Result: ${data.data.result}`);
      console.log(`Confidence: ${data.data.confidence}`);
      return true;
    } else {
      console.error('❌ Response structure is invalid');
      console.log(
        'Expected: { data: { result: boolean, confidence: number } }'
      );
      console.log('Received:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ API Connection Test Failed:');
    console.error('Error Type:', error.name);
    console.error('Error Message:', error.message);
    console.error('Full Error:', error);

    // Additional debugging info
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.log('💡 This might be a CORS or network connectivity issue');
      console.log('💡 Check if the API server is running and accessible');
      console.log(
        '💡 Verify the extension has proper permissions in manifest.json'
      );
    }

    return false;
  }
}

// Run the test
testAPIConnection().then((success) => {
  if (success) {
    console.log('🎉 API connection test PASSED');
  } else {
    console.log('💥 API connection test FAILED');
  }
});
