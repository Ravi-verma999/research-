# Hosting & Android Guide

Your application works as a **"Full-Stack Web App" (Node.js backend + React frontend)**. The backend server manages extracting text from PDFs/Ebooks, storing data in the local folder, and running the offline AI models.

## 1. Accessing Online From Anywhere
You do not need to struggle with complex hosting manually. **This app is already online!**
You can access your app on any device, from anywhere, using your AI Studio Shared App URL:
**[Shared App URL (Preview)](https://ais-pre-fp6t7foqnnmbffztxhubnz-751539361457.asia-east1.run.app)**

*Note: Since it's hosted by Google AI Studio, data uploaded here might reset if the environment clears. For permanent personal hosting, see "Permanent Cloud Hosting" below.*

## 2. Permanent Cloud Hosting (Free)
If you want to host this forever online (like putting it on a drive) so that your book data is saved:
You can host this repository for free using services like **Render.com** or **Railway.app**:
1. Download this project as a ZIP or Export to GitHub.
2. Create an account on [Render.com](https://render.com/).
3. Create a **New Web Service**, connect your GitHub repo.
4. Use the following settings:
   - **Environment:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm run start`
   - Add a "Disk" (Persistent Storage) mounted to the `.data` folder so your `store.json` book database is never deleted.

## 4. Hosting It On Your Existing Website
If you already have a website (WordPress, Wix, HTML, etc.) and want this AI agent to appear there, you need to embed it. 

### Step 1: Deploy to Render.com (or Railway)
Your existing website cannot naturally run Node.js backend code. Therefore, you first need to host this application following **Section 2 (Permanent Cloud Hosting)** above.

### Step 2: Embed via iFrame
Once your app is hosted (e.g., `https://your-pentester-app.onrender.com`), you can put it inside your website. 
Copy and paste this HTML code into your website's page:

```html
<iframe 
  src="https://your-pentester-app.onrender.com" 
  width="100%" 
  height="700px" 
  style="border: none; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);"
  title="Pentesting AI Support Agent">
</iframe>
```

This will embed the entire interface into your site, and because the backend runs on Render, your users can upload books, query, and trigger the AI agent directly from your website!
