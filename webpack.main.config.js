module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main.js',
  externals: {
    'tesseract.js': 'commonjs2 tesseract.js',
    'tesseract.js-core': 'commonjs2 tesseract.js-core',
  },
  // Put your normal webpack config below here
  module: {
    rules: require('./webpack.rules'),
  },
};
