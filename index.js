const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
dotenv.config();
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

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
    // app.get('/parcels', async (req, res) => {
    //   const parcels = await parcelCollection.find().toArray();
    //   res.send(parcels);
    // });

    //parcel api get
    app.get('/parcels', async (req, res) => {
      try {
        const email = req.query.email; // ?email=
        console.log('Email query parameter:', email);
        const query = email
          ? { created_by: email } // ই‑মেইল থাকলে ফিল্টার
          : {}; // না থাকলে সব ডকুমেন্ট
        console.log('Query:', query);
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

    //delete my parcel
    app.delete('/parcels/:id', async (req, res) => {
      try {
        const id = req.params.id; // URL থেকে parcel ID নেওয়া
        const query = { _id: new ObjectId(id) }; // ObjectId টাইপে কনভার্ট করা
        const result = await parcelCollection.deleteOne(query); // ডিলিট করা

        if (result.deletedCount === 1) {
          res.send({ success: true, message: 'Parcel deleted' });
        } else {
          res.status(404).send({ success: false, message: 'Parcel not found' });
        }
      } catch (error) {
        console.error('Error deleting parcel:', error);
        res.status(500).send({ message: 'Failed to delete parcel' });
      }
    });

    // get parcel by ID
    app.get('/parcels/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).send({ message: 'Parcel not found' });
        }

        res.send(parcel);
      } catch (error) {
        console.error('Error getting parcel by ID:', error);
        res
          .status(500)
          .send({ message: 'Failed to get parcel', error: error.message });
      }
    });

    // 💳 Create Payment Intent
    // ⬇︎ পরিবর্তিত /create-payment-intent রাউট
    app.post('/create-payment-intent', async (req, res) => {
      const amountInCents = parseInt(req.body.amountInCents, 10); // নিশ্চিত করো integer

      if (!amountInCents) {
        return res
          .status(400)
          .send({ error: 'amountInCents missing or invalid' });
      }

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // 🟢 সঠিক ফিল্ড নাম
          currency: 'usd', // 'usd' টেস্টে OK, 'bdt' এখনো GA নয়
          automatic_payment_methods: { enabled: true }, // চাইলে রাখো
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error('Stripe error:', err);
        res.status(500).send({ error: err.message });
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
