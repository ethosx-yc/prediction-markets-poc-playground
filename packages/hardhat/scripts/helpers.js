const USDC_ABI = require("../ABIs/ProxyUSDC.json").abi;
const ConditionalToken_ABI = require("../ABIs/ConditionalTokens.json").abi;
const TradeMatcher_ABI = require("../ABIs/TradeMatcher.json").abi;

const addresses = {
  USDC: "0xaDD98F6E5a11a337870350dDb72eDaDFB1DFc3cc",
  ConditionalToken: "0xE94E50D9Ce853128DE059C961ac99A235Bb80c57",
  TradeMatcher: "0x9CB495Ac087AA98D80a54C95121be52773704859",
};

const abis = {
  USDC: USDC_ABI,
  ConditionalToken: ConditionalToken_ABI,
  TradeMatcher: TradeMatcher_ABI,
};

const pusdc = new ethers.Contract(addresses.USDC, abis.USDC, ethers.provider);
const conditionalToken = new ethers.Contract(
  addresses.ConditionalToken,
  abis.ConditionalToken,
  ethers.provider
);
const tradeMatcher = new ethers.Contract(
  addresses.TradeMatcher,
  abis.TradeMatcher,
  ethers.provider
);

async function getSignedOrder(signer, order, tradeMatcherAddress) {
  const domainData = {
    name: "TradeMatcher",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: tradeMatcherAddress,
  };

  const orderType = [
    { name: "maker_address", type: "address" },
    { name: "token_id", type: "uint256" },
    { name: "quantity", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "buy", type: "bool" },
    { name: "deadline", type: "uint256" },
    { name: "salt", type: "uint256" },
  ];

  const message = {
    maker_address: order[0],
    token_id: order[1],
    quantity: order[2],
    price: order[3],
    buy: order[4],
    deadline: order[5],
    salt: order[6],
  };

  const types = {
    Order: orderType,
  };

  const signature = await signer.signTypedData(domainData, types, message);

  return signature;
}

async function prepareConditionAndRegister(oracleAddress, questionId) {
  const [admin] = await ethers.getSigners();
  await conditionalToken
    .connect(admin)
    .prepareCondition(oracleAddress, questionId, 2); // write

  const conditionID = await conditionalToken.getConditionId(
    oracleAddress,
    questionId,
    2
  );

  const parentCollectionID = ethers.zeroPadValue("0x", 32);

  const yesTokenId = await conditionalToken.getPositionId(
    pusdc.target,
    await conditionalToken.getCollectionId(parentCollectionID, conditionID, 1) //0b01
  );
  const noTokenId = await conditionalToken.getPositionId(
    pusdc.target,
    await conditionalToken.getCollectionId(parentCollectionID, conditionID, 2) //0b10
  );

  await tradeMatcher
    .connect(admin)
    .registerToken(yesTokenId, noTokenId, conditionID); // write

  return {
    conditionID: conditionID,
    parentCollectionID: parentCollectionID,
    yesTokenId: yesTokenId,
    noTokenId: noTokenId,
  };
}

async function mintCollateral(receipientAddress, amount) {
  const [admin] = await ethers.getSigners();

  await pusdc.connect(admin).mint(amount);
  await pusdc.connect(admin).transfer(receipientAddress, amount);
}

async function enableTrading(signer) {
  await pusdc.connect(signer).approve(tradeMatcher.target, ethers.MaxUint256);
  await conditionalToken
    .connect(signer)
    .setApprovalForAll(tradeMatcher.target, true);
}

async function prepareOrder(
  signer,
  tokenId,
  qty,
  limitPrice,
  buySide,
  deadline
) {
  const order = [
    signer.address,
    tokenId,
    qty,
    limitPrice,
    buySide,
    deadline,
    await tradeMatcher.minValidSalt(signer.address, tokenId, buySide),
  ];
  const signature = await getSignedOrder(signer, order, tradeMatcher.target);
  return order.concat(signature);
}

async function registerTrades(takerOrder, makerOrders, takerQty, makerQtys) {
  const [admin] = await ethers.getSigners();

  return await tradeMatcher
    .connect(admin)
    .registerTrades(takerOrder, makerOrders, takerQty, makerQtys);
}

async function getBalances(address, oracleAddress, questionId) {
  const conditionID = await conditionalToken.getConditionId(
    oracleAddress,
    questionId,
    2
  );

  const parentCollectionID = ethers.zeroPadValue("0x", 32);

  const yesTokenId = await conditionalToken.getPositionId(
    pusdc.target,
    await conditionalToken.getCollectionId(parentCollectionID, conditionID, 1) //0b01
  );
  const noTokenId = await conditionalToken.getPositionId(
    pusdc.target,
    await conditionalToken.getCollectionId(parentCollectionID, conditionID, 2) //0b10
  );
  return {
    collateral: await pusdc.balanceOf(address),
    yesToken: await conditionalToken.balanceOf(address, yesTokenId),
    noToken: await conditionalToken.balanceOf(address, noTokenId),
  };
}

async function splitTokens(signer, conditionID, qty) {
  await pusdc.connect(signer).approve(conditionalToken.target, qty);

  return await conditionalToken
    .connect(signer)
    .splitPosition(
      pusdc.target,
      ethers.zeroPadValue("0x", 32),
      conditionID,
      [1, 2],
      qty
    );
}

async function mergeTokens(signer, conditionID, qty) {
  return await conditionalToken
    .connect(signer)
    .mergePositions(
      pusdc.target,
      ethers.zeroPadValue("0x", 32),
      conditionID,
      [1, 2],
      qty
    );
}

async function reportPayouts(questionId, isYes) {
  const [admin] = await ethers.getSigners();
  await conditionalToken
    .connect(admin)
    .reportPayouts(questionId, [isYes ? 1 : 0, isYes ? 0 : 1]);
}

async function redeemPosition(signer, conditionID) {
  await conditionalToken
    .connect(signer)
    .redeemPositions(
      pusdc.target,
      ethers.zeroPadValue("0x", 32),
      conditionID,
      [1, 2]
    );
}

module.exports = {
  getSignedOrder,
  prepareConditionAndRegister,
  mintCollateral,
  enableTrading,
  prepareOrder,
  registerTrades,
  getBalances,
  splitTokens,
  mergeTokens,
  reportPayouts,
  redeemPosition,
};

/*

const { prepareConditionAndRegister, mintCollateral, enableTrading, prepareOrder, registerTrades, getBalances, splitTokens, mergeTokens, reportPayouts, redeemPosition } = require("./scripts/scratchbook");

const [admin, taker, maker1, maker2] = await ethers.getSigners();

const questionId = ethers.id("Will ETH be above 4000 USD on 1st Aug 2024?");
const oracleAddress = admin.address;

const response = await prepareConditionAndRegister(oracleAddress, questionId);
const conditionID = response.conditionID;
const parentCollectionID = response.parentCollectionID;
const yesTokenId = response.yesTokenId;
const noTokenId = response.noTokenId;

await mintCollateral(taker.address, 1000000000);
await mintCollateral(maker1.address, 1000000000);
await mintCollateral(maker2.address, 1000000000);

await enableTrading(taker);
await enableTrading(maker1);
await enableTrading(maker2);

// taker buys 1000000 yes tokens, maker1 and maker2 each buy 500000 no tokens
const takerOrder1 = await prepareOrder(taker, yesTokenId, 1000000, 200000, true, ethers.MaxUint256);
const maker1Order1 = await prepareOrder(maker1, noTokenId, 500000, 800000, true, ethers.MaxUint256);
const maker2Order1 = await prepareOrder(maker2, noTokenId, 500000, 800000, true, ethers.MaxUint256);

await registerTrades(takerOrder1, [maker1Order1, maker2Order1], 1000000, [500000, 500000]);

await getBalances(taker.address, oracleAddress, questionId);
await getBalances(maker1.address, oracleAddress, questionId);
await getBalances(maker2.address, oracleAddress, questionId);

// taker sells 500000 yes tokens, maker1 sells 500000 no tokens
const takerOrder2 = await prepareOrder(taker, yesTokenId, 500000, 250000, false, ethers.MaxUint256);
const maker1Order2 = await prepareOrder(maker1, noTokenId, 500000, 750000, false, ethers.MaxUint256);

await registerTrades(takerOrder2, [maker1Order2], 500000, [500000]);

await getBalances(taker.address, oracleAddress, questionId);
await getBalances(maker1.address, oracleAddress, questionId);
await getBalances(maker2.address, oracleAddress, questionId);

// taker sells 500000 yes tokens to maker1
const takerOrder3 = await prepareOrder(taker, yesTokenId, 500000, 300000, false, ethers.MaxUint256);
const maker1Order3 = await prepareOrder(maker1, yesTokenId, 500000, 300000, true, ethers.MaxUint256);

await registerTrades(takerOrder3, [maker1Order3], 500000, [500000]);

await getBalances(taker.address, oracleAddress, questionId);
await getBalances(maker1.address, oracleAddress, questionId);
await getBalances(maker2.address, oracleAddress, questionId);


// maker2 splits 1000000 no tokens into yes and no tokens positions
let rct = await (await splitTokens(maker2, conditionID, 1000000)).wait();
let tokenIds = rct.logs[rct.logs.length - 2].args.ids;

await getBalances(maker2.address, oracleAddress, questionId);
await getBalances(maker2.address, oracleAddress, questionId);

// maker2 merges 500000 yes and 500000 no tokens positions
await mergeTokens(maker2, conditionID, 500000);
await getBalances(maker2.address, oracleAddress, questionId);
await getBalances(maker2.address, oracleAddress, questionId);

// market resolves to yes
await reportPayouts(questionId, true);

// market resolves to no
await reportPayouts(questionId, false);

// maker2 redeems 500000 yes and 500000 no tokens positions
await redeemPosition(maker1, conditionID);
await getBalances(maker1.address, oracleAddress, questionId);
 
*/
