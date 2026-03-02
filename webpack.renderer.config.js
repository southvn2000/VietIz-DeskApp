const path = require('path');
const rules = require('./webpack.rules');

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

rules.push({
  test: /\.(png|jpe?g|gif|svg|webp)$/i,
  type: 'asset/resource',
});

rules.push({
  test: /\.html$/i,
  include: [
    path.resolve(__dirname, 'src/pages/layout'),
    path.resolve(__dirname, 'src/pages/screens'),
  ],
  type: 'asset/source',
});

module.exports = {
  // Put your normal webpack config below here
  module: {
    rules,
  },
  devServer: {
    host: '127.0.0.1',
    client: {
      webSocketURL: {
        protocol: 'ws',
        hostname: '127.0.0.1',
        pathname: '/ws',
      },
    },
  },
};
