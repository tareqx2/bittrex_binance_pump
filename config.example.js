let config = {

  preferredExchange: 'binance', //If the coin is listed on both binance and bittrex, which exchange do you want to give priority (binance/bittrex/both)
  market_buy_inflation: .14, // This is to make sure your buy order gets in. Sets the market buy to current price + inflation percentage
  /**
  * This section pertains to Bittrex only
  **/
  bittrex: {
    // TRADE KEY
    api_key: '',
    api_secret: '',
    investment: .0001
  },
  /**
  * This section pertains to Binance only
  **/
  binance: {
    // TRADE KEY
    api_key: '',
    api_secret: '',
    investment: .0001
  },
};

module.exports = {
  bittrex: config.bittrex,
  binance: config.binance,
  main: config
};
