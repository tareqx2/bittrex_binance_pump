/**********************************
* Library imports
***********************************/
const binance = require('node-binance-api');
const binanceConfig = require('./config').binance;
const mainConfig = require('./config').main;
var bittrex = require('node.bittrex.api');
const bittrexConfig = require('./config').bittrex;
let logger = require('./logger');

/**********************************
* VARIABLES
***********************************/
let isExchangeInfoLoaded = false;
let isPricesLoaded = false;
let isBittrexLoaded = false;
let isPreloaded = false;

let prices = {
  binance: {},
  bittrex: {}
};

bittrex.options({
  'apikey' : bittrexConfig.api_key,
  'apisecret' : bittrexConfig.api_secret,
  verbose: false
});

binance.options({
  'APIKEY': binanceConfig.api_key,
  'APISECRET':binanceConfig.api_secret,
  useServerTime: true,
});

function preloadCoins() {
  bittrex.getmarketsummaries( function( data, err ) {
    if(err) {
      logger.error(`Error loading coins for bittrex: ${err.message}`);
    }
    data.result.forEach(coin => {
      let coinName = normalizeCoinName(coin.MarketName);
      //if coinName is null, it is not a BTC pair
      if(coinName) {
        prices.bittrex[coinName] = coin.Ask;
      }
    });
    isBittrexLoaded = true;
    isPreloaded = isExchangeInfoLoaded && isPricesLoaded;
  });

  binance.exchangeInfo((data) => {
    for ( let obj of data.symbols ) {
      let filters = {minNotional:0.001,minQty:1,maxQty:10000000,stepSize:1,minPrice:0.00000001,maxPrice:100000};
      for ( let filter of obj.filters ) {
        if ( filter.filterType == "MIN_NOTIONAL" ) {
          filters.minNotional = filter.minNotional;
        } else if ( filter.filterType == "PRICE_FILTER" ) {
          filters.minPrice = filter.minPrice;
          filters.maxPrice = filter.maxPrice;
        } else if ( filter.filterType == "LOT_SIZE" ) {
          filters.minQty = filter.minQty;
          filters.maxQty = filter.maxQty;
          filters.stepSize = filter.stepSize;
        }
      }
      obj.symbol = normalizeCoinName(obj.symbol);
      if(obj.symbol) {
        if(prices.binance[obj.symbol]) {
          prices.binance[obj.symbol].filter = filters;
        } else {
          prices.binance[obj.symbol] = {
            filter: filters,
            price: null
          };
        }
      }
    }
    isExchangeInfoLoaded = true;
    isPreloaded = isBittrexLoaded && isExchangeInfoLoaded && isPricesLoaded;

  });

  binance.prices((data) => {
    Object.keys(data).forEach(coin => {
      let coinName = normalizeCoinName(coin);
      if(coinName) {
        if(prices.binance[coinName]) {
          prices.binance[coinName].price = parseFloat(data[coin]);
        } else {
          prices.binance[coinName] = {
            filter: null,
            price: parseFloat(data[coin])
          }
        }
      }
    });
    isPricesLoaded = true;
    isPreloaded = isBittrexLoaded && isExchangeInfoLoaded && isPricesLoaded;
  });
}

function isPreloadedComplete() {
  return isPreloaded;
}

function getPrices() {
  return prices;
}

function normalizeCoinName(coin) {
  //bittrex format: BTC-XLM
  //binance format: XLMBTC
  if(coin.indexOf('BTC') === -1) {
    return null;
  }
  coin = coin.replace('BTC','').replace('-','');
  return coin.toLowerCase();
}

function getCoinInfo(coin) {
  let infoResponse = {
    coin: coin,
    hasBittrex: false,
    hasBinance: false,
    bittrexPrice: null,
    binancePrice: null,
    binanceFormatInfo: null
  };
  coin = coin.toLowerCase();
  if(prices.bittrex[coin]) {
    infoResponse.hasBittrex = true;
    infoResponse.bittrexPrice = prices.bittrex[coin];
  }
  if(prices.binance[coin]) {
    infoResponse.hasBinance = true;
    infoResponse.binancePrice = prices.binance[coin].price;
    infoResponse.binanceFormatInfo = prices.binance[coin].filter;
  }
  return infoResponse;
}
module.exports = {
  preloadCoins: preloadCoins,
  binance: binance,
  bittrex: bittrex,
  normalizeCoinName: normalizeCoinName,
  getPrices: getPrices,
  isPreloadedComplete: isPreloadedComplete,
  getCoinInfo: getCoinInfo
}
