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
var tFill; //global variable for lastPrice taken from binance websocket
var reqs;
var realQty;
var avgPrice;
var last;
var coinInput;

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
  rl.question('\nInput a coin: ', (answer) =>
  {
    let info = api.getCoinInfo(answer);
    coinInput = answer.toUpperCase();
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
      logger.log('info','\nCoin was not found on Binance or Bittrex');
      waitForInput();
    }
  });
}

function buyBittrex(info) {
  let price = info.bittrexPrice + (info.bittrexPrice * mainConfig.market_buy_inflation);
  let shares = bittrexConfig.investment / price;
  let coin = 'BTC-'+info.coin.toUpperCase();

  term.brightBlue('BITTREX: ').defaultColor(`Attempting to buy ${shares.toFixed(8)} shares of ${info.coin.toUpperCase()} at `).brightGreen(`B${price.toFixed(8)}\n\n`);
  
  api.bittrex.buylimit({market: coin, quantity: shares, rate: price}, (data,err) => {
    if(err) {
      term.brightBlue('BITTREX: ').defaultColor(`Purchase was unsuccesful: `).brightRed(`${err.message}\n`);
    } else {
      buyOrderPoll = setInterval(function() {
        api.bittrex.getorder({uuid: data.result.uuid}, (data,err) => {
          //console.log(data);
          if(err) {
            term.brightBlue('BITTREX: ').defaultColor(`Something went wrong with getOrderBuy: ${err.message}\n`);
          } else {
            if(data.result.IsOpen) {
              term.brightBlue('BITTREX: ').defaultColor('Order not yet filled\n');
            } else if(data.result.CancelInitiated) {
              term.brightBlue('BITTREX: ').defaultColor('Order cancel initiated by user\n');
            } else {
              term.brightBlue('BITTREX: ').defaultColor(`Successfully bought ${data.result.Quantity} shares of ${info.coin.toUpperCase()+'BTC'} at `).brightGreen(`B${(data.result.PricePerUnit).toFixed(8)}\n\n`);
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
  reqs = info.binanceFormatInfo;
  
  console.log('');
  term.brightYellow('BINANCE: ').defaultColor(`Attempting to buy ${shares.toFixed(8)} shares of ${coinInput} at `).brightGreen(`B${price.toFixed(8)}\n\n`);

  const flags = {type: 'MARKET', newOrderRespType: 'FULL'};
  api.binance.marketBuy(coin, shares, flags, function(response) {
    if(response.code) {
      console.log("Error Code: " + response.code);
      console.log(response.msg);
      rl.question('\nRetry? y/n: ', (answer) => {
        if(answer == 'y' || answer == 'Y' ) {
          buyBinance(info);
        }
        else {
          exit();
        }
      });
    }
    else {
      var x = findAveragePrice(response);
      avgPrice = x.average;
      realQty = x.quantity;
      let orderID = response.orderId;
  
      if(realQty < info.binanceFormatInfo.minQty) {
        console.log('Your order is less than the minimum quantity needed to make a purchase');
      }
  
      term.brightYellow('BINANCE: ').defaultColor(`Successfully bought ${realQty.toFixed(8)} shares of ${response.symbol} at `).brightGreen(`B${avgPrice}\n\n`);
  
      //checkOrderStatus(coin, orderID);
      pollProfitAndLoss(coin, avgPrice);
    }
  });
}

function sellBinance(asset, quantity) {
  quantity = convertToCorrectLotSize(quantity,reqs);

  term.brightYellow('BINANCE: ').defaultColor(`Attempting to sell ${quantity.toFixed(8)} shares of ${coinInput} at `).brightGreen(`B${last}\n\n`);

  const flags = {type: 'MARKET', newOrderRespType: 'FULL'};
  api.binance.marketSell(asset, quantity, flags, function(response) {
    if(response.code) {
      console.log("Error Code: " + response.code);
      console.log(response.msg);
      rl.question('\nRetry? y/n: ', (answer) => {
        if(answer == 'y' || answer == 'Y' ) {
          sellBinance(asset, realQty);
        }
        else {
          exit();
        }
      });
    }
    else {
      var x = findAveragePrice(response);
      var avgSell = x.average;
      var sellQty = x.quantity;
      var totalProfit = convertToPercentage(tFill, avgSell);
  
      term.brightYellow('BINANCE: ').defaultColor(`Successfully sold ${sellQty.toFixed(8)} shares of ${response.symbol} at `).brightGreen(`B${avgSell}\n\n`);
  
      if(totalProfit.indexOf("-") > -1) {
        term('You are now down ').brightRed(`${totalProfit} %`);
        exit('\n\nYou make some, you lose some');
      } else {
        term('You are now up ').brightGreen(` ${totalProfit} %`);
        exit('\n\nAnother win for TIC');
      }
    }
  });
}

function pollProfitAndLoss(asset, fillPrice) {
  api.binance.websockets.chart(asset, "1m", (symbol, interval, chart) => {
    let tick = api.binance.last(chart);
    last = chart[tick].close;
    tFill = fillPrice;

    avgGain = convertToPercentage(fillPrice, last);

    if(avgGain.indexOf("-") > -1) {
      term('Last Price: ').brightRed(`${last}\t`).defaultColor('Gain: ').brightRed(`${avgGain} %\n`);
    } else {
      term('Last Price: ').brightGreen(`${last}\t`).defaultColor('Gain: ').brightGreen(` ${avgGain} %\n`);
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

function findAveragePrice(array) {
  var sum = {
      total: 0.0,
      quantity: 0.0
  };
  if(Array.isArray(array.fills)) {
    for(i in array.fills) {
        sum.total += Number(array.fills[i].price) * Number(array.fills[i].qty);
        sum.quantity += Number(array.fills[i].qty);
    }
  }
  sum.average = (sum.total / sum.quantity).toFixed(8);
  return sum;
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
