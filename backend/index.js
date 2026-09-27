import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ status: 'Backend is up' });
});

app.listen(port, (error) => {
  if (error) {
    console.error('API failed to start', error);
    process.exit(1);
  }

  console.log(`API listening on port ${port}`);
});
