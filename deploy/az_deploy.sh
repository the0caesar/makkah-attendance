#!/usr/bin/env bash
# One-shot Azure Functions deploy (API proxy). $0 within the F1 free grant.
# PRE: `az login` completed by Essam (browser approval) + active Azure subscription.
set -e
cd "$(dirname "$0")/.."

LOC=northeurope            # closest Azure region to Makkah
RG=makkah-attendance
FN=makkah-attendance-api

CFG=~/AppData/Local/hermes/dataverse.json
TENANT=$(python -c "import json;print(json.load(open(r'$CFG'.replace('~',r'C:/Users/Essam Omar')))['tenant_id'])")
CID=$(python -c "import json;print(json.load(open(r'$CFG'.replace('~',r'C:/Users/Essam Omar')))['client_id'])")
SECRET=$(python -c "import json;print(json.load(open(r'$CFG'.replace('~',r'C:/Users/Essam Omar')))['client_'+'secret'])")
ORGURL=$(python -c "import json;print(json.load(open(r'$CFG'.replace('~',r'C:/Users/Essam Omar')))['org_url'])")

# package: api_core.py must sit next to function_app.py
cp api_core.py functionapp/api_core.py

echo "== 1/3 resource group + function app =="
az group create -l $LOC -n $RG --tags purpose=makkah-attendance
az functionapp create \
  --resource-group $RG --name $FN \
  --runtime python --runtime-version 3.11 --functions-version 4 \
  --os-type Linux --consumption-plan \
  --storage @create \
  | head -c 400
echo

echo "== 2/3 publish code =="
az functionapp deployment source config set \
  --name $FN --resource-group $RG \
  --src functionapp --build-remote true | tail -5

echo "== 3/3 app settings (secrets) =="
az functionapp config appsettings set --name $FN --resource-group $RG \
  --settings PYTHON_SCRIPT_FILE=function_app.py \
    TENANT_ID=$TENANT \
    CLIENT_ID=$CID \
    CLIENT_SECRET=$SECRET \
    ORG_URL=$ORGURL \
    DEV_EMPLOYEE_NUMBER=70180 | tail -3

echo
echo "Function URL: https://$FN.azurewebsites.net"
echo "Health:  curl https://$FN.azurewebsites.net/"
echo "Smoke:   curl -H \"X-Dev-Identity: 1\" https://$FN.azurewebsites.net/api/whoami"
