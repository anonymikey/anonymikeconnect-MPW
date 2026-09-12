const packages = [
  {
    id: 'monthly_unlimited',
    name: 'Monthly Unlimited',
    price: 600,
    amount: 600,
    duration: '30 days',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'MOST POPULAR'
  },
  {
    id: 'monthly_100gb',
    name: 'Monthly 100 GB',
    price: 400,
    amount: 400,
    duration: '30 days',
    bandwidth: '100 GB',
    data: '100 GB',
    label: 'DATA PLAN'
  },
  {
    id: 'weekly_unlimited',
    name: '7 Days Unlimited',
    price: 150,
    amount: 150,
    duration: '7 days',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'WEEKLY'
  },
  {
    id: 'daily_pro',
    name: 'Daily Unlimited Pro',
    price: 50,
    amount: 50,
    duration: '24 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'PRO'
  },
  {
    id: 'daily_standard',
    name: 'Daily Unlimited Standard',
    price: 30,
    amount: 30,
    duration: '24 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: 'STANDARD'
  },
  {
    id: 'hours_12',
    name: '12 Hours Unlimited',
    price: 20,
    amount: 20,
    duration: '12 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: '12H'
  },
  {
    id: 'hours_5',
    name: '5 Hours Unlimited',
    price: 10,
    amount: 10,
    duration: '5 hours',
    bandwidth: 'unlimited',
    data: 'unlimited',
    label: '5H'
  }
];

module.exports = {
  packages,
  findPackageById(packageId) {
    return packages.find((item) => item.id === packageId) || null;
  }
};
