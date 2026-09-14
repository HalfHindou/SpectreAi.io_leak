const fetch = require('node-fetch');
require('dotenv').config({ path: '../.env' });

const CODEX_API_KEY = process.env.CODEX_API_KEY;
const CODEX_BASE_URL = 'https://graph.codex.io/graphql';

async function test() {
  // First get pairs for BONK on Solana
  const pairsQuery = `
    query GetPairs($tokenAddress: String!, $networkId: Int!) {
      listPairsForToken(
        tokenAddress: $tokenAddress
        networkId: $networkId
        limit: 1
      ) {
        address
        token0
        token1
      }
    }
  `;
  
  const pairsRes = await fetch(CODEX_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': CODEX_API_KEY,
    },
    body: JSON.stringify({ 
      query: pairsQuery, 
      variables: { 
        tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK on Solana 
        networkId: 1399811149 
      } 
    }),
  });
  
  const pairsData = await pairsRes.json();
  console.log('Pairs:', JSON.stringify(pairsData, null, 2));
  
  if (pairsData.data?.listPairsForToken?.[0]) {
    const pairAddress = pairsData.data.listPairsForToken[0].address;
    console.log('\nPair address:', pairAddress);
    
    // Now get events for this pair
    const eventsQuery = `
      query GetTokenEvents($address: String!, $networkId: Int!, $limit: Int!) {
        getTokenEvents(
          query: {
            address: $address
            networkId: $networkId
          }
          limit: $limit
        ) {
          items {
            timestamp
            eventType
            token0SwapValueUsd
            token1SwapValueUsd
            maker
            transactionHash
            data {
              ... on SwapEventData {
                amount0In
                amount0Out
                amount1In
                amount1Out
                priceUsd
                amount0
                amount1
              }
            }
          }
        }
      }
    `;
    
    const eventsRes = await fetch(CODEX_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': CODEX_API_KEY,
      },
      body: JSON.stringify({ 
        query: eventsQuery, 
        variables: { 
          address: pairAddress,
          networkId: 1399811149,
          limit: 3
        } 
      }),
    });
    
    const eventsData = await eventsRes.json();
    console.log('\nEvents:', JSON.stringify(eventsData, null, 2));
  }
}

test().catch(console.error);
