const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
//middlewares
app.use(cors());
app.use(express.json());
//mongoDB connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@testingc.xpwe350.mongodb.net/?retryWrites=true&w=majority&appName=TestingC`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //db Create
    const db = client.db('parcelDB');
    const parcelCollection = db.collection('parcels');
    //get all parcels
    app.get('/parcels', async (req, res) => {
      const parcels = await parcelCollection.find().toArray();
      res.send(parcels);
    });

    //parcel api get
    app.get('/parcels', async (req, res) => {
      try {
        const email = req.query.email; // ?email=
        const query = email
          ? { created_by: email } // ই‑মেইল থাকলে ফিল্টার
          : {}; // না থাকলে সব ডকুমেন্ট

        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 }) // DESC sort
          .toArray();

        res.send(parcels);
      } catch (err) {
        console.error('Error fetching parcels:', err);
        res.status(500).send({ message: 'Failed to fetch parcels' });
      }
    });

    //post a parcel
    // POST Create a new parcel
    app.post('/parcels', async (req, res) => {
      try {
        // 1️⃣ রিকোয়েস্ট বডি থেকে নতুন পার্সেল
        const newParcel = req.body;

        // 2️⃣ MongoDB‑র কালেকশনে ইনসার্ট
        const result = await parcelCollection.insertOne(newParcel);

        // 3️⃣ সফল হলে 201 (Created) রেসপন্স
        res.status(201).send(result);
        console.log('Parcel added successfully:', result);
      } catch (error) {
        // 4️⃣ কোনো এরর হলে 500 রেসপন্স
        console.error('Error adding parcel:', error);
        res
          .status(500)
          .send({ message: 'Failed to add parcel', error: error.message });
      }
    });
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

//simple route
app.get('/', (req, res) => {
  res.json('Welcome to Zap Shift Server');
});
// start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
