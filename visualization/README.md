This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Running against minikube

When the frontend is deployed in Kubernetes it expects the visualization backend to be reachable at the `/visualization/api` prefix. If you want to exercise the full stack locally with minikube:

1. Point your shell at the minikube Docker daemon and build the images:

   ```bash
   eval "$(minikube docker-env)"
   docker build --build-arg NEXT_DISABLE_TURBO=1 -t karlod/visualization-backend:local ../visualization-backend
   docker build --build-arg NEXT_DISABLE_TURBO=1 -t karlod/visualization-frontend:local .
   ```

2. Deploy the backend and frontend manifests:

   ```bash
   kubectl apply -k ../base/visualization-backend
   kubectl apply -k ../base/visualization-frontend
   ```

3. Patch the deployments to use the locally built images (and avoid pulling from GHCR):

   ```bash
   kubectl patch deployment visualization-backend \
     --type='json' \
     -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'
   kubectl set image deployment/visualization-backend backend=karlod/visualization-backend:local

   kubectl patch deployment visualization-frontend \
     --type='json' \
     -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'
   kubectl set image deployment/visualization-frontend frontend=karlod/visualization-frontend:local
   ```

4. Once the pods are running, expose both services locally:

   ```bash
   kubectl port-forward svc/visualization-backend 8080:80
   # in another terminal
   kubectl port-forward svc/visualization-frontend 3000:80
   ```

5. Open [http://localhost:3000](http://localhost:3000) to view the visualization. The frontend now reaches the backend via `http://localhost:8080/visualization/api` through the port-forward.

When you are finished testing, undo the Docker environment with:

```bash
eval "$(minikube docker-env -u)"
```
