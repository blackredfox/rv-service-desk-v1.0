import { getPrisma } from './src/lib/db';

async function testSingleton() {
  try {
    const prisma1 = await getPrisma();
    const prisma2 = await getPrisma();
    
    // Check if they are the same object instance
    const isSingleton = prisma1 === prisma2;
    console.log('Singleton test:', isSingleton ? 'PASS - Same instance' : 'FAIL - Different instances');
    
    // Clean up
    await prisma1.$disconnect();
    
    process.exit(isSingleton ? 0 : 1);
  } catch (error) {
    console.error('Singleton test failed:', error);
    process.exit(1);
  }
}

testSingleton();