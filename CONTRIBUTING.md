# Flujo de trabajo (Gitflow)

Este repositorio usa **Gitflow**.

## Ramas permanentes

| Rama | Propósito | Despliegue en Vercel |
|---|---|---|
| `main` | Código en producción. Solo recibe merges de `release/*` y `hotfix/*`. | Producción |
| `develop` | Integración de funcionalidades terminadas. Base de todas las ramas `feature/*`. | Preview (staging) |

## Ramas temporales

| Prefijo | Sale de | Se integra en | Uso |
|---|---|---|---|
| `feature/<nombre>` | `develop` | `develop` | Nueva funcionalidad |
| `release/<x.y.z>` | `develop` | `main` **y** `develop` | Preparar una versión: ajustes finales, versión en `package.json`, changelog |
| `hotfix/<x.y.z>` | `main` | `main` **y** `develop` | Corrección urgente en producción |
| `bugfix/<nombre>` | `develop` | `develop` | Corrección no urgente |

## Comandos

Con [git-flow AVH](https://github.com/petervanderdoes/gitflow-avh) (`git flow init -d` usa estos mismos nombres):

```bash
git flow feature start chat-historial
git flow feature finish chat-historial

git flow release start 0.2.0
git flow release finish -n 0.2.0   # merge a main y a develop, sin tag (-n)

git flow hotfix start 0.2.1
git flow hotfix finish -n 0.2.1
```

Con git puro:

```bash
# feature
git checkout develop && git pull
git checkout -b feature/chat-historial
# ... commits ...
git push -u origin feature/chat-historial   # abrir PR hacia develop

# release
git checkout -b release/0.2.0 develop
# ajustar versión / changelog
git checkout main && git merge --no-ff release/0.2.0
git checkout develop && git merge --no-ff release/0.2.0
git branch -d release/0.2.0
git push origin main
git push origin develop
```

## Versiones

No se usan tags de git. La versión vive en el campo `version` de los `package.json` y en [CHANGELOG.md](./CHANGELOG.md); cada rama `release/x.y.z` o `hotfix/x.y.z` actualiza ambos antes de integrarse a `main`.

## Convenciones

- Commits con [Conventional Commits](https://www.conventionalcommits.org/es/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Los merges a `develop` y `main` se hacen por **Pull Request** con CI en verde.
- Se usa `--no-ff` para conservar la historia de cada rama.

## Protección de ramas recomendada (GitHub → Settings → Branches)

- `main` y `develop`: requerir PR, requerir el check `CI` y prohibir push directo.
