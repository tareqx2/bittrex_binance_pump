const { createLogger, format, transports } = require('winston');

const { combine, timestamp, label, printf } = format;

const myFormat = printf(info => {
  return `${info.message}`;
});

const logger = createLogger({
  level: 'info',
  format: combine(
    timestamp(),
    format.colorize({ all: true }),
    myFormat
  ),
  transports: [
    new transports.File({ filename: 'output.log' }),
    new transports.Console()
  ]
});

module.exports = logger;
