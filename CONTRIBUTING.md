# Flujo de trabajo (Gitflow)

Este repositorio usa **Gitflow**.

## Ramas permanentes

| Rama | Propósito | Despliegue en Vercel |
|---|---|---|
| `main` | Código en producción. Solo recibe merges de `release/*` y `hotfix/*`. Cada merge lleva un tag `vX.Y.Z`. | Producción |
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
git flow release finish 0.2.0      # merge a main + tag + merge a develop

git flow hotfix start 0.2.1
git flow hotfix finish 0.2.1
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
git checkout main && git merge --no-ff release/0.2.0 && git tag -a v0.2.0 -m "v0.2.0"
git checkout develop && git merge --no-ff release/0.2.0
git branch -d release/0.2.0
git push origin main develop --tags
```

## Convenciones

- Commits con [Conventional Commits](https://www.conventionalcommits.org/es/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Los merges a `develop` y `main` se hacen por **Pull Request** con CI en verde.
- Se usa `--no-ff` para conservar la historia de cada rama.

## Protección de ramas recomendada (GitHub → Settings → Branches)

- `main` y `develop`: requerir PR, requerir el check `CI` y prohibir push directo.
