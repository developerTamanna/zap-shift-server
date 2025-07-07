const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
dotenv.config();
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 3000;
//middlewares
app.use(cors());
app.use(express.json());

// firebase-admin --save

const serviceAccount = require('./firebase-admin-key.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
    const paymentCollection = db.collection('payments');
    const usersCollection = db.collection('users');
    const ridersCollection = db.collection('riders');

    // Custom middlewares related code
    // Custom middleware
    const verifyFBToken = async (req, res, next) => {
      // 1️⃣ সঠিক জায়গায় হেডার পড়ুন
      const authHeader = req.headers.authorization;

      // 2️⃣ এই একই ভ্যারিয়েবলই চেক করুন
      if (!authHeader) {
        return res.status(401).send({ message: 'unauthorized access' });
      }

      // 3️⃣ "Bearer xyz" থেকে টোকেন আলাদা করুন
      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).send({ message: 'unauthorized access' });
      }

      // 4️⃣ (এখানে চাইলে টোকেন verify করবেন)
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(401).send({ message: 'unauthorized access' });
      }
      // ✅ রিকোয়েস্ট পরের হ্যান্ডলারকে দিন
    };

    //user apis
    app.post('/users', async (req, res) => {
      try {
        const { email } = req.body;

        // 1️⃣ Check if email exists
        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }

        // 2️⃣ Check if user already exists
        const userExist = await usersCollection.findOne({ email });

        if (userExist) {
          // 3️⃣ Update last_log_in if exists
          const updated = await usersCollection.updateOne(
            { email },
            {
              $set: {
                last_log_in: new Date().toISOString(),
              },
            }
          );

          return res.send({
            message: 'User already exists. last_log_in updated.',
            inserted: false,
            updatedCount: updated.modifiedCount,
            user: userExist,
          });
        }

        // 4️⃣ Insert new user
        const user = {
          ...req.body,
          created_at: new Date().toISOString(),
          last_log_in: new Date().toISOString(),
          role: req.body.role || 'user',
        };

        const result = await usersCollection.insertOne(user);

        res.status(201).send({
          message: 'User inserted successfully',
          inserted: true,
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error('Error inserting/updating user:', err.message);
        res.status(500).send({ message: 'Server error', error: err.message });
      }
    });

    //get all parcels
    // app.get('/parcels', async (req, res) => {
    //   const parcels = await parcelCollection.find().toArray();
    //   res.send(parcels);
    // });

    //parcel api get
    app.get('/parcels', verifyFBToken, async (req, res) => {
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

    // GET: payment history (user email → own, else all)  ✅
    app.get('/payments', verifyFBToken, async (req, res) => {
      console.log('headers is payment', req.headers);
      try {
        const userEmail = req.query.email; // ?email=user@mail.com
        console.log('decoded', req.decoded);
        if (req.decoded.email !== userEmail) {
          return res.status(403).send({ message: 'forbidden access' });
        }

        const query = userEmail ? { email: userEmail } : {}; // filter or all

        /* DESC sort latest‑first */
        const payments = await paymentCollection
          .find(query)
          .sort({ paid_at: -1 }) // 🔹 correct field + syntax
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).send({ message: 'Failed to get payments' });
      }
    });

    /* ---------- record payment + mark parcel paid ---------- */
    /*POST ---------- record payment & mark parcel paid ---------- */
    app.post('/payments', async (req, res) => {
      /* 1. body destructure + validation */
      const { parcelId, email, amount, paymentMethod, transactionId } =
        req.body;

      if (!parcelId || !email || !amount) {
        return res
          .status(400)
          .send({ message: 'parcelId, email, and amount are required' });
      }

      try {
        /* 2. update parcel → payment_status: 'paid' */
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: { payment_status: 'paid' } } // ← $set জরুরি
        );

        if (updateResult.matchedCount === 0) {
          return res
            .status(404)
            .send({ message: 'Parcel not found or already paid' });
        }

        /* 3. insert payment record */
        const paymentDoc = {
          parcelId: new ObjectId(parcelId),
          email,
          amount,
          paymentMethod,
          transactionId,
          paid_at_string: new Date().toISOString(),
          paidAt: new Date(),
        };

        const paymentResult = await paymentCollection.insertOne(paymentDoc);

        /* 4. success response */
        return res.status(201).send({
          message: 'Payment recorded and parcel marked as paid',
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        console.error('Payment processing failed:', error);
        return res.status(500).send({ message: 'Failed to record payment' });
      }
    });

    //riders related apis
    app.post('/riders', async (req, res) => {
      const rider = req.body;
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });

    // GET /riders/pending
    app.get('/riders/pending', async (req, res) => {
      try {
        const pendingRiders = await ridersCollection
          .find({ status: 'pending' })
          .sort({ created_at: -1 }) // Optional: নতুন অ্যাপ্লিকেশন আগে
          .toArray();

        res.send(pendingRiders);
      } catch (error) {
        console.error('Error fetching pending riders:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    //riders status
    // PATCH /riders/:id  { status: 'active' | 'rejected' }
    app.patch('/riders/:id', async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      try {
        const result = await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to update status' });
      }
    });

    //riders active
    app.get('/riders/active', async (req, res) => {
      const result = await ridersCollection
        .find({ status: 'active' })
        .toArray();
      res.send(result);
    });
    // POST /tracking  → add one tracking event
    // app.post('/tracking', async (req, res) => {
    //   const { tracking_id, parcel_id, status, message, update_by } = req.body;

    //   // 1️⃣ quick validation
    //   if (!tracking_id || !status) {
    //     return res
    //       .status(400)
    //       .send({ message: 'tracking_id & status are required' });
    //   }

    //   try {
    //     // 2️⃣ document to insert
    //     const log = {
    //       tracking_id,
    //       parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
    //       status,
    //       message,
    //       update_by,
    //       time: new Date(), // timestamp
    //     };

    //     // 3️⃣ insertOne (not insertedId)
    //     const result = await trackCollection.insertOne(log);

    //     // 4️⃣ success response
    //     res.status(201).send({ success: true, insertedId: result.insertedId });
    //   } catch (err) {
    //     console.error('Add tracking error:', err);
    //     res.status(500).send({ message: 'Failed to add tracking entry' });
    //   }
    // });

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
// app.listen(port, () => {
//   console.log(`Server is running on port ${port}`);
// });
