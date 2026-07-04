const fs = require('fs').promises;
const pdf = require('pdf-parse');

/**
 * Parse PDF menu and extract menu items
 * This is a simplified parser - you may need to customize based on your PDF format
 */
async function parsePdfMenu(filePath) {
  try {
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdf(dataBuffer);
    
    const text = data.text;
    const lines = text.split('\n').filter(line => line.trim());
    
    const menuItems = [];
    let currentCategory = 'Uncategorized';
    
    // Simple parsing logic - customize based on your PDF format
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check if line contains a price (₹ or Rs)
      const priceMatch = line.match(/(?:₹|Rs\.?)\s*(\d+(?:\.\d{2})?)/i);
      
      if (priceMatch) {
        const price = parseFloat(priceMatch[1]);
        const name = line.replace(priceMatch[0], '').trim();
        
        if (name && price > 0) {
          menuItems.push({
            name: name,
            description: '',
            price: price,
            category: currentCategory,
            available: true,
            veg: true // Default to veg, can be updated manually
          });
        }
      } else if (line.length > 3 && line.length < 50 && !line.includes('₹')) {
        // Likely a category header
        currentCategory = line;
      }
    }
    
    // If no items found, create sample items
    if (menuItems.length === 0) {
      menuItems.push(
        {
          name: 'Sample Item 1',
          description: 'Extracted from PDF - Please edit',
          price: 100,
          category: 'Main Course',
          available: true,
          veg: true
        },
        {
          name: 'Sample Item 2',
          description: 'Extracted from PDF - Please edit',
          price: 150,
          category: 'Main Course',
          available: true,
          veg: true
        }
      );
    }
    
    return menuItems;
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to parse PDF menu');
  }
}

module.exports = { parsePdfMenu };