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

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded?.email;
        if (!email) {
          return res.status(401).send({ message: 'Unauthorized' });
        }

        const user = await usersCollection.findOne({ email });

        if (!user || user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden: Admins only' });
        }

        // চাইলে রোল পরের রুটেও পাঠাতে পারো
        req.userRole = 'admin';

        next();
      } catch (err) {
        console.error('verifyAdmin error:', err);
        res.status(500).send({ message: 'Server error during admin check' });
      }
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
    // 📁 [GET] /parcels?email=...&payment_status=...&delivery_status=...
    app.get('/parcels', verifyFBToken, async (req, res) => {
      try {
        const { email, payment_status, delivery_status } = req.query;

        // 🔍 Build dynamic query
        const query = {};
        if (email) query.created_by = email;
        if (payment_status) query.payment_status = payment_status;
        if (delivery_status) query.delivery_status = delivery_status;

        // 📦 Fetch parcels with optional filters
        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_date: -1 }) // Descending order by date
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
    app.get('/riders/pending', verifyFBToken, verifyAdmin, async (req, res) => {
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
    // PATCH /riders/:id/status
    app.patch('/riders/:id/status', async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;

      // 0️⃣  status ভ্যালিড কি না চেক করা ভাল
      const allowed = ['active', 'rejected', 'inactive'];
      if (!allowed.includes(status)) {
        return res.status(400).send({ message: 'Invalid status value' });
      }

      try {
        /* 1️⃣ rider status আপডেট */
        const riderResult = await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (riderResult.matchedCount === 0) {
          return res.status(404).send({ message: 'Rider not found' });
        }

        /* 2️⃣  status === 'active' হলে User role = 'rider' */
        let roleResult = null;
        if (status === 'active' && email) {
          roleResult = await usersCollection.updateOne(
            { email },
            { $set: { role: 'rider' } }
          );
        }

        /* 3️⃣  success response */
        res.send({
          modified: riderResult.modifiedCount,
          riderId: id,
          roleUpdated: roleResult?.modifiedCount || 0,
        });
      } catch (err) {
        console.error('Rider status update error:', err);
        res.status(500).send({ message: 'Failed to update status' });
      }
    });

    //riders active
    app.get('/riders/active', verifyFBToken, verifyAdmin, async (req, res) => {
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

    // // [GET] Search users by email

    // [GET] /users/search?email=john&limit=10
    app.get('/users/search', async (req, res) => {
      const emailQuery = req.query.email || '';
      const limit = parseInt(req.query.limit, 10) || 10; // ডিফল্ট 10

      // সাম negative বা NaN হলে fallback
      const safeLimit = limit > 0 && limit <= 100 ? limit : 10;

      if (!emailQuery.trim()) {
        return res.status(400).json({ message: 'Missing email query' });
      }

      const regex = new RegExp(emailQuery, 'i'); // case‑insensitive, partial

      try {
        const users = await usersCollection
          .find(
            { email: { $regex: regex } },
            { projection: { email: 1, role: 1, created_at: 1 } }
          )
          .sort({ created_at: -1 }) // নতুন আগে চাইলে
          .limit(safeLimit) // 🔹 লিমিট!
          .toArray();

        res.json(users);
      } catch (err) {
        console.error('User search error:', err);
        res.status(500).json({ message: 'Something went wrong' });
      }
    });

    // [PATCH] /users/:id/role
    app.patch(
      '/users/:id/role',
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;

        // নিরাপদ role চেক
        if (!['admin', 'user'].includes(role)) {
          return res.status(400).json({ message: 'Invalid role' });
        }

        try {
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
          );

          if (result.modifiedCount > 0) {
            res.send({ message: `User role updated to ${role}`, result });
          } else {
            res
              .status(404)
              .json({ message: 'User not found or already has this role' });
          }
        } catch (error) {
          console.error('Error updating role:', error);
          res.status(500).json({ message: 'Failed to update role' });
        }
      }
    );

    //GET: Get user role by email
    app.get('/users/:email/role', async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }

        // role না থাকলে default 'user' রিটার্ন করবে
        res.send({ role: user.role || 'user' });
      } catch (error) {
        res
          .status(500)
          .send({ message: 'Failed to fetch role', error: error.message });
      }
    });

    //  riders available
    // PATCH assign rider to parcel
    /* ---------- 1. GET /riders/available ---------- */
    //  ➜  http://localhost:3000/riders/available?district=Brahmanbaria
    app.get('/riders/available', async (req, res) => {
      const { district } = req.query;
      try {
        const riders = await ridersCollection
          .find({
            district, // exact match with parcel.senderService
            status: { $in: ['approved', 'active'] },
            work_status: 'available',
          })
          .toArray();

        res.send(riders);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to load riders' });
      }
    });

    /* ---------- 2. PATCH /parcels/:id/assign ---------- */
    //  body: { riderId, riderName }
    app.patch('/parcels/:id/assign', async (req, res) => {
      const { id } = req.params;
      const { riderId, riderName } = req.body;

      try {
        /* 2‑A. update parcel */
        const parcelRes = await parcelCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              delivery_status: 'in_transit',
              assigned_rider_id: riderId,
              assigned_rider_name: riderName,
              assigned_at: new Date(),
            },
          }
        );

        if (parcelRes.matchedCount === 0)
          return res.status(404).send({ message: 'Parcel not found' });

        /* 2‑B. update rider status */
        await ridersCollection.updateOne(
          { _id: new ObjectId(riderId) },
          { $set: { work_status: 'in_delivery' } }
        );

        res.send({ modified: parcelRes.modifiedCount });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Failed to assign rider' });
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
