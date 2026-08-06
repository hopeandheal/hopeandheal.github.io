const fs = require('fs');
const path = require('path');

const filesToUpdate = ['index.html', 'order.html', 'admin.html'];

for (const file of filesToUpdate) {
  const filePath = path.join(__dirname, '..', file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace .jpg and .png with .webp
    content = content.replace(/\.jpg/g, '.webp');
    content = content.replace(/\.jpeg/g, '.webp');
    content = content.replace(/\.png/g, '.webp');
    
    // Add loading="lazy" to all img tags that don't have it
    content = content.replace(/<img(?![^>]*loading=["']lazy["'])([^>]+)>/g, '<img$1 loading="lazy">');
    
    fs.writeFileSync(filePath, content);
    console.log(`Updated ${file}`);
  }
}
