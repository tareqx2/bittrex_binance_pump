/**********************************
* Library imports
***********************************/
const binanceConfig = require('./config').binance;
const mainConfig = require('./config').main;
const bittrexConfig = require('./config').bittrex;
var api = require('./priceLoader');
let _ = require('lodash');
let underscore = require('underscore');
var parseArgs = require('minimist');
var logger = require('./logger');
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**********************************
* VARIABLES
***********************************/
var buyOrderPoll;

/**********************************
* INITIALIZATION
***********************************/
//preload bittrex and binance coins, this will give us prices beforehand and knowlege of what coins are on which exchange
logger.log('info', 'Loading coins...');
api.preloadCoins();
setInterval(api.preloadCoins, 5000);
let loadingCheck = setInterval(checkLoadingState,1000);


/**********************************
* FUNCTIONS
***********************************/
function checkLoadingState() {
  if(api.isPreloadedComplete()) {
    logger.log('info', 'Coins are loaded!');
    clearInterval(loadingCheck);
    waitForInput();
  }
}

function waitForInput() {
  rl.question(`Input a coin: `, (answer) =>
  {
    let info = api.getCoinInfo(answer);
    if(info.hasBittrex || info.hasBinance) {
      if(info.hasBittrex && info.hasBinance) {
        if(mainConfig.preferredExchange.toLowerCase() == 'both') {
          buyBinance(info);
          buyBittrex(info);
        } else {
          switch(mainConfig.preferredExchange.toLowerCase()) {
            case 'binance':
              buyBinance(info);
              break;
            case 'bittrex':
              buyBittrex(info);
              break;
            default:
              buyBinance(info);
              break;
          }
        }
      } else if(info.hasBittrex) {
        buyBittrex(info);
      } else if(info.hasBinance) {
        buyBinance(info);
      }
    } else {
      logger.log('info',`coin not found or not on binance/bittrex`);
      waitForCoinInput();
    }
  });
}

function buyBittrex(info) {
  let price = info.bittrexPrice + (info.bittrexPrice * mainConfig.market_buy_inflation);
  console.log(bittrexConfig.investment);
  let shares = bittrexConfig.investment / price;
  console.log(`buying ${shares} of ${info.coin} at ${price} on bittrex`);
  api.bittrex.buylimit({market: 'BTC-'+info.coin.toUpperCase(), quantity: shares, rate: price}, (data,err) => {
    if(err) {
      logger.log('error', `Bittrex purchase was unsuccesful: ${err.message}`);
    } else {
      buyOrderPoll = setInterval(function() {
        api.bittrex.getorder({uuid: data.result.uuid}, (data,err) => {
          if(err) {
            exit(`something went wrong with getOrderBuy: ${err.message}`);
          } else {
            if(data.result.IsOpen) {
              console.log(`order not yet filled`);
            } else if(data.result.CancelInitiated) {
              console.log(`order cancel was initiated by user`);
            } else {
              console.log(`ORDER FILLED at Ƀ${data.result.PricePerUnit}!`);
              clearInterval(buyOrderPoll);
            }
          }
        });
      },2000);
    }
  });
}

function buyBinance(info) {
  let price = info.binancePrice + (info.binancePrice * mainConfig.market_buy_inflation);
  let shares = binanceConfig.investment / price;
  console.log(`calculated shares ${shares}`);
  shares = convertToCorrectLotSize(shares,info.binanceFormatInfo);
  console.log(`buying ${shares} of ${info.coin} on binance`);
  api.binance.marketBuy(info.coin.toUpperCase()+"BTC", shares, function(response) {
    console.log(response);
    console.log(`binance buy response: coin: ${response.symbol}, shares: ${response.executedQty}`);
    // binance.orderStatus("ETHBTC", orderid, (error, orderStatus, symbol) => {
    //   console.log(symbol+" order status:", orderStatus);
    // });
  });
}

function checkOrderStatus(orderUUID) {

}

function convertToCorrectLotSize(shares, requirement) {
  let step_size;
  let order_size;
  //console.log(`shares ${shares}`);
  if(requirement && requirement.stepSize) {
    step_size = parseFloat(requirement.stepSize);
    if (shares % step_size != 0) {
      shares = parseInt(shares / step_size) * step_size;
    }
  }

    //console.log(`orderSize: ${order_size}`);
  return shares;
  //   let stringArray = requirement.stepSize.split('.');
  //   if(stringArray.length > 1) {
  //     let trimSize = stringArray[1].replace(new RegExp('0', 'g'),'').length;
  //     shares = shares.toFixed(trimSize);
  //   }
  // }
  // return shares;
}

function exit(message) {
  if(message) {
    console.log(message);
  }
  process.exit();
}
