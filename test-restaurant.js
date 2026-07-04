require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('./src/models/Restaurant');

async function testDatabase() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    console.log('MongoDB URI:', process.env.MONGODB_URI ? 'Configured ✅' : 'Missing ❌');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB successfully!\n');
    
    // Count restaurants
    const count = await Restaurant.countDocuments();
    console.log(`📊 Total restaurants in database: ${count}\n`);
    
    if (count === 0) {
      console.log('⚠️  WARNING: No restaurants found in database!');
      console.log('You need to create an account first by signing up.\n');
      process.exit(0);
    }
    
    // List all restaurants
    const restaurants = await Restaurant.find({}, 'name email uniqueCode menuItems createdAt');
    console.log('📋 All restaurants:\n');
    console.log('='.repeat(60));
    
    restaurants.forEach((r, i) => {
      console.log(`\n${i + 1}. Restaurant Name: ${r.name}`);
      console.log(`   Email: ${r.email}`);
      console.log(`   UniqueCode: ${r.uniqueCode}`);
      console.log(`   Menu Items: ${r.menuItems.length}`);
      console.log(`   Created: ${r.createdAt}`);
      console.log(`   Test URL: https://qr-dine-tan.vercel.app/menu/${r.uniqueCode}`);
    });
    
    console.log('\n' + '='.repeat(60));
    
    // Test finding by uniqueCode
    if (restaurants.length > 0) {
      const testCode = restaurants[0].uniqueCode;
      console.log(`\n🧪 Testing database query with uniqueCode: ${testCode}`);
      
      const found = await Restaurant.findOne({ uniqueCode: testCode });
      
      if (found) {
        console.log('✅ Query Result: FOUND');
        console.log(`   Restaurant: ${found.name}`);
        console.log(`   Menu Items: ${found.menuItems.length}`);
      } else {
        console.log('❌ Query Result: NOT FOUND (This is a bug!)');
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('\n💡 NEXT STEPS:');
    console.log('1. Copy one of the "Test URL" links above');
    console.log('2. Open it in your browser');
    console.log('3. It should show the restaurant menu, NOT 404\n');
    
    await mongoose.connection.close();
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

console.log('🚀 Starting database test...\n');
testDatabase();