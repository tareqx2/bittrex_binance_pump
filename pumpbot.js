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
var term = require( 'terminal-kit' ).terminal;
//let parsedArgs = parseArgs(process.argv.slice(2));

/**********************************
* VARIABLES
***********************************/
var buyOrderPoll;
var tQty; // global variable for the quantity filled for an order
var tFill; //global variable for lastPrice taken from binance websocket

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
  rl.question(`\nInput a coin: `, (answer) =>
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
      logger.log('info',`coin was not found on binance/bittrex`);
      waitForCoinInput();
    }
  });
}

function buyBittrex(info) {
  let price = info.bittrexPrice + (info.bittrexPrice * mainConfig.market_buy_inflation);
  //console.log(bittrexConfig.investment);
  let shares = bittrexConfig.investment / price;
  let coin = 'BTC-'+info.coin.toUpperCase();
  term.brightBlue(`BITTREX: `).defaultColor(`Attempting to buy ${shares} shares of ${info.coin} at `).brightGreen(`B${price}`);
  api.bittrex.buylimit({market: coin, quantity: shares, rate: price}, (data,err) => {
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
              console.log(`ORDER FILLED at Ƀ${displaySats(data.result.PricePerUnit)}!`);
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
  let coin = info.coin.toUpperCase()+"BTC";

  shares = convertToCorrectLotSize(shares,info.binanceFormatInfo);
  console.log('');
  term.brightYellow(`BINANCE: `).defaultColor(`Attempting to buy ${shares} shares of ${info.coin.toUpperCase()} at `).brightGreen(`B${price.toFixed(8)}\n\n`);

  const flags = {type: 'MARKET', newOrderRespType: 'FULL'};
  api.binance.marketBuy(coin, shares, flags, function(responseBuy) {

    var avgPrice = findAveragePrice(responseBuy);

    term.brightYellow(`BINANCE: `).defaultColor(`Successfully bought ${responseBuy.executedQty} shares of ${responseBuy.symbol} at `).brightGreen(`B${avgPrice}\n\n`);

    tQty = responseBuy.executedQty;
    let orderID = responseBuy.orderId;

    //checkOrderStatus(coin, orderID);
    pollProfitAndLoss(coin, avgPrice);
  });
}

/*
function checkOrderStatus(asset, id) {
  api.binance.orderStatus(asset, id, function(responseStatus) {
    console.log(responseStatus);
  });
}
*/

function pollProfitAndLoss(asset, fillPrice) {

  api.binance.websockets.chart(asset, "1m", (symbol, interval, chart) => {
    let tick = api.binance.last(chart);
    var last = chart[tick].close;
    tFill = fillPrice;

    avgGain = convertToPercentage(fillPrice, last);

    if(avgGain.indexOf("-") > -1) {
      term(`Last Price: `).brightRed(`${last}\t`).defaultColor(`Gain: `).brightRed(`${avgGain} %\n`);
    } else {
      term(`Last Price: `).brightGreen(`${last}\t`).defaultColor(`Gain: `).brightGreen(` ${avgGain} %\n`);
    }
  });

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      exit('\nCtrl + C Detected, Exiting...\n');
    } else if (key.ctrl && key.name === 's') {
      inLoop = 0;
      console.log('\nCtrl + S Detected, Selling...\n');
      sellBinance(asset, tQty);
    }
  });
}

function sellBinance(asset, quantity) {
  const flags = {type: 'MARKET', newOrderRespType: 'FULL'};
  api.binance.marketSell(asset, quantity, flags, function(responseSell) {

    var avgPrice = findAveragePrice(responseSell);
    var totalProfit = convertToPercentage(avgPrice, tFill);

    term.brightYellow(`BINANCE: `).defaultColor(`Successfully sold ${responseSell.executedQty} shares of ${responseSell.symbol} at `).brightGreen(`B${avgPrice}\n`);

    if(totalProfit.indexOf("-") > -1) {
      term(`You are now down `).brightRed(`${totalProfit} %`);
      exit('\n\nYou make some, you lose some');
    } else {
      term(`You are now up `).brightGreen(` ${totalProfit} %`);
      exit('\n\nAnother win for TIC');
    }
  });
}

function sellBinancePart(asset, percent) {

}

function findAveragePrice(array) {
  var sum = 0;
  for(var i = 0; i < array.fills.length; i++) {
      sum += array.fills[i].price;
  }
  return sum / array.fills.length;
}

function convertToPercentage(initial, next) {
  var x = next - initial;
  x = x / next * 100;
  x = x.toFixed(2);
  return x;
}

function convertToCorrectLotSize(shares, requirement) {
  if(requirement && requirement.stepSize) {
    let stringArray = requirement.stepSize.split('.');
    if(stringArray.length > 1) {
      let trimSize = stringArray[1].replace(new RegExp('0', 'g'),'').length;
      shares = shares.toFixed(trimSize);
    }
  }
  return shares;
}

function exit(message) {
  if(message) {
    console.log(message);
  }
  process.exit();
}