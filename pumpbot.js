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
var fixedQty;
var realQty;

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
      logger.log('info',`\nCoin was not found on Binance or Bittrex`);
      waitForInput();
    }
  });
}

function buyBittrex(info) {
  let price = info.bittrexPrice + (info.bittrexPrice * mainConfig.market_buy_inflation);
  let shares = bittrexConfig.investment / price;
  let coin = 'BTC-'+info.coin.toUpperCase();

  term.brightBlue(`BITTREX: `).defaultColor(`Attempting to buy ${shares.toFixed(8)} shares of ${info.coin.toUpperCase()} at `).brightGreen(`B${price.toFixed(8)}\n\n`);
  
  api.bittrex.buylimit({market: coin, quantity: shares, rate: price}, (data,err) => {
    if(err) {
      term.brightBlue(`BITTREX: `).defaultColor(`Purchase was unsuccesful: `).brightRed(`${err.message}\n`);
    } else {
      buyOrderPoll = setInterval(function() {
        api.bittrex.getorder({uuid: data.result.uuid}, (data,err) => {
          //console.log(data);
          if(err) {
            term.brightBlue(`BITTREX: `).defaultColor(`Something went wrong with getOrderBuy: ${err.message}\n`);
          } else {
            if(data.result.IsOpen) {
              term.brightBlue(`BITTREX: `).defaultColor(`Order not yet filled\n`);
            } else if(data.result.CancelInitiated) {
              term.brightBlue(`BITTREX: `).defaultColor(`Order cancel initiated by user\n`);
            } else {
              term.brightBlue(`BITTREX: `).defaultColor(`Successfully bought ${data.result.Quantity} shares of ${info.coin.toUpperCase()+'BTC'} at `).brightGreen(`B${(data.result.PricePerUnit).toFixed(8)}\n\n`);
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
  fixedQty = info.binanceFormatInfo;
  
  console.log('');
  term.brightYellow(`BINANCE: `).defaultColor(`Attempting to buy ${shares.toFixed(8)} shares of ${info.coin.toUpperCase()} at `).brightGreen(`B${price.toFixed(8)}\n\n`);

  const flags = {type: 'MARKET', newOrderRespType: 'FULL'};
  api.binance.marketBuy(coin, shares, flags, function(response) {
    //console.log(response);
    var avgPrice = findAveragePrice(response);
    let orderID = response.orderId;
    realQty = findRealQty(response);

    if(realQty < info.binanceFormatInfo.minQty) {
      console.log('your order is less than the minimum quantity needed to make a purchase');
    }

    term.brightYellow(`BINANCE: `).defaultColor(`Successfully bought ${realQty.toFixed(8)} shares of ${response.symbol} at `).brightGreen(`B${avgPrice}\n\n`);

    //checkOrderStatus(coin, orderID);
    pollProfitAndLoss(coin, avgPrice);
  });
}

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
      sellBinance(asset, realQty);
    }
  });
}

function sellBinance(asset, quantity) {
  quantity = convertToCorrectLotSize(quantity,fixedQty);
  const flags = {type: 'MARKET', newOrderRespType: 'FULL'};
  api.binance.marketSell(asset, quantity, flags, function(response) {
    //console.log(response);
    var avgSell = findAveragePrice(response);
    var totalProfit = convertToPercentage(tFill, avgSell);
    var sellQty = findRealQty(response);

    term.brightYellow(`BINANCE: `).defaultColor(`Successfully sold ${sellQty.toFixed(8)} shares of ${response.symbol} at `).brightGreen(`B${avgSell}\n\n`);

    if(totalProfit.indexOf("-") > -1) {
      term(`You are now down `).brightRed(`${totalProfit} %`);
      exit('\n\nYou make some, you lose some');
    } else {
      term(`You are now up `).brightGreen(` ${totalProfit} %`);
      exit('\n\nAnother win for TIC');
    }
  });
}

function findRealQty(array) {
  var sum1 = 0;
  var sum2 = 0;

  for(var i = 0; i < array.fills.length; i++) {
    var num1 =  Number(array.fills[i].commission);
    var num2 =  Number(array.fills[i].qty);
    sum1 += num1;
    sum2 += num2;
  }

  if (array.fills[0].commissionAsset == 'BNB') {
    return sum2;
  } else if (array.fills[0].commissionAsset == 'BTC') {
    return sum2;
  } else {
    return sum2 - sum1;
  }
}

function findAveragePrice(array) {
  var sum = 0;
  for(var i = 0; i < array.fills.length; i++) {
    var x =  Number(array.fills[i].price);
    sum += x;
  }
  return (sum / array.fills.length).toFixed(8);
}

function convertToPercentage(initial, next) {
  var x = next - initial;
  x = x / next * 100;
  x = x.toFixed(2);
  return x;
}

function convertToCorrectLotSize(shares, requirement) {
  let step_size;
  let order_size;
  if(requirement && requirement.stepSize) {
    step_size = parseFloat(requirement.stepSize);
    if (shares % step_size != 0) {
      shares = parseInt(shares / step_size) * step_size;
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
