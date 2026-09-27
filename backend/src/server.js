import { createApp } from './app.js';

const port = process.env.PORT || 3000;
const app = createApp();

app.listen(port, (error) => {
  if (error) {
    console.error('API failed to start', error);
    process.exit(1);
  }

  console.log(`API listening on port ${port}`);
});
