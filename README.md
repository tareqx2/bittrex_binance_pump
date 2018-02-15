# bittrex_binance_pump
purchases coins on either bittrex or binance (or both)

# installation
1. clone or download the project
2. run ```npm install``` in project directory
3. create/rename the config.js (using the config.example.js as a template)

# running the application
This script is meant to be already running prior to buying the coin(s), 
it needs to be running to pull information from binance and bittrex (price and trade requirements)
It takes only a few seconds to gather up all the information and be ready to enter in a coin symbol, but i would recommend running at least 30 seconds prior.

running it as simple as ```node pumpbot.js``` and waiting for the "Input coin:" prompt

# configuration
Most of the configuration is very straight forward, there is a section for bittrex and binance keys along with how much you'd like to invest for each purchase (in btc)
The ```preferredExchange``` option will pick which exchange to make the purchase on in the event that the coin exists on both binance and bittrex.

If you'd like to purchase the coin on *BOTH* exchanges, set the option as
```preferredExchange = 'both',```
