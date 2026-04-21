#!/bin/zsh
# Switch to personal GitHub profile
cd "$(dirname "$0")"
git config user.name "Dean Wheatley"
git config user.email "deanwheatley@hotmail.com"

remote=$(git remote get-url origin 2>/dev/null)
if [[ -n "$remote" ]]; then
  repo_path=$(echo "$remote" | sed -E 's|.*[:/]([^/]+/[^/]+)(\.git)?$|\1|')
  git remote set-url origin "git@github.com:${repo_path}.git"
fi

echo "✅ Switched to personal profile"
echo "   Name:   $(git config user.name)"
echo "   Email:  $(git config user.email)"
echo "   Remote: $(git remote get-url origin 2>/dev/null)"

sleep 3
