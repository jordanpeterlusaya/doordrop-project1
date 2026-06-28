# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Standalone admin website

The repo also includes a separate Firebase-backed dispatch website in `admin-website/`.

```bash
npm run admin:serve
```

Then open `http://localhost:4173`.

## Production API setup

Shared APKs must not use `localhost`, `10.0.2.2`, or `192.168.x.x` for `EXPO_PUBLIC_API_BASE_URL`.
Those addresses only work on your machine or your Wi-Fi. The backend is configured for Firebase Cloud Functions at the `api` HTTPS function.

Local backend start command:

```bash
npm install
npm run backend:start
```

Required backend environment variables:

```bash
GOOGLE_SERVER_API_KEY=your-server-google-key
CORS_ALLOWED_ORIGINS=*
```

Deploy the backend to Firebase:

```bash
npm --prefix backend install
firebase deploy --only functions:api
```

After deployment, confirm:

```bash
curl https://us-central1-efootball-app-9d175.cloudfunctions.net/api/health
```

Then set the app build environment:

```bash
EXPO_PUBLIC_API_BASE_URL=https://us-central1-efootball-app-9d175.cloudfunctions.net/api
```

Preview and production Android builds fail early if the API URL is missing or points to a private/local IP.

## DoorDropDrive app

The repo also includes a separate driver-facing Expo app in `doordropdrive/`.

```bash
npm run drive:start
```

Inside that app, drivers can:

- sign in or register with Firebase Authentication
- register their vehicle details
- share live foreground GPS updates to Firestore
- see pending orders and accept them
- move active orders through pickup, transit, and delivered states

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
