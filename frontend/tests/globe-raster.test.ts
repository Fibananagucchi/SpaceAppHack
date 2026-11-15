/** Synthetic numeric/geometry cases stay in tests, never the product data path. */
import {describe,it,expect} from 'vitest';
import {geographyIsLand,rasterTextureData} from '../src/globeRasterData';
import type {GlobeLayer} from '../src/globeGeometry';

const layer:GlobeLayer={domain:'world',rows:2,cols:2,lat0:-1,lon0:-1,dlat:2,dlon:2,values:[-4,0,3,null],limit:3,unit:'test',label:'Test'};
const sample=(data:ReturnType<typeof rasterTextureData>,x:number,y:number)=>{const p=(y*data.width+x)*4,q=data.cells[p]*65536+data.cells[p+1]*256+data.cells[p+2];return {alpha:data.cells[p+3],value:data.minimum+q/16777215*data.span};};
describe('Masked display textures',()=>{
  it('retains negative/zero/positive source values and never turns null into valid zero',()=>{
    const data=rasterTextureData(layer);expect(data.validCount).toBe(3);expect(sample(data,1,1).value).toBe(-4);expect(sample(data,2,1).value).toBeCloseTo(0,5);expect(sample(data,1,2).value).toBe(3);expect(sample(data,2,2).alpha).toBe(0);expect(sample(data,2,1).alpha&128).toBe(128);
  });
  it('makes significance a nearest discrete flag and masks non-ok statistical cells',()=>{
    const data=rasterTextureData({...layer,significant:[true,false,true,false],statusLabels:['ok','ok','insufficient_for_test','no_data']});expect(sample(data,1,1).alpha&64).toBe(64);expect(sample(data,2,1).alpha&128).toBe(128);expect(sample(data,1,2).alpha).toBe(0);expect(data.values[(2*data.width+1)*4+3]).toBe(0);
  });
  it('provides cyclic ghost texels for the world and clamped edges for Europe',()=>{
    const world=rasterTextureData(layer),europe=rasterTextureData({...layer,domain:'europe'});expect(sample(world,0,1).value).toBeCloseTo(0,5);expect(sample(world,3,1).value).toBe(-4);expect(sample(europe,0,1).value).toBe(-4);expect(sample(europe,3,1).value).toBeCloseTo(0,5);
  });
  it('permits filtering only in quadrants whose four source cells are valid',()=>{
    const grid={...layer,domain:'europe' as const,rows:3,cols:3,values:[1,1,1,1,1,null,1,1,1]},data=rasterTextureData(grid);
    expect(sample(data,2,2).alpha&15).toBe(5);
    const isolated=rasterTextureData({...grid,values:[null,null,null,null,0,null,null,null,null]});expect(sample(isolated,2,2).alpha&15).toBe(0);expect(sample(isolated,2,2).alpha&128).toBe(128);
  });
  it('does not mutate the source arrays or clip extreme values to the colour legend before filtering',()=>{
    const values=[-1e15,0,4e16,null];Object.freeze(values);const data=rasterTextureData({...layer,values,limit:1});expect(sample(data,1,2).value).toBe(4e16);expect(data.minimum).toBe(-1e15);expect(sample(data,2,1).value).toBeCloseTo(0,-10);expect(values).toEqual([-1e15,0,4e16,null]);
  });
  it('keeps an all-null layer transparent and a constant zero layer genuinely valid',()=>{
    const empty=rasterTextureData({...layer,values:[null,null,null,null]}),zero=rasterTextureData({...layer,values:[0,0,0,0]});expect(empty.validCount).toBe(0);expect([...empty.cells].every(v=>v===0)).toBe(true);expect(zero.validCount).toBe(4);expect(sample(zero,1,1).value).toBe(0);expect(sample(zero,1,1).alpha&128).toBe(128);expect(sample(zero,1,1).alpha&15).toBe(15);
  });
  it('fails explicitly on a finite-input range that cannot be represented',()=>{expect(()=>rasterTextureData({...layer,values:[-1e308,1e308,null,null]})).toThrow('invalid_display_range');});
});
describe('Independent geographic water mask',()=>{
  it('uses the same alpha threshold, polar clamping and date-line wrapping as the shader',()=>{
    const mask={width:2,height:2,data:Uint8ClampedArray.from([0,0,0,0,0,0,0,255,0,0,0,128,0,0,0,127])} as ImageData;
    expect(geographyIsLand(mask,{lat:45,lon:-90})).toBe(false);expect(geographyIsLand(mask,{lat:45,lon:90})).toBe(true);expect(geographyIsLand(mask,{lat:-90,lon:-180})).toBe(true);expect(geographyIsLand(mask,{lat:-90,lon:180})).toBe(true);expect(geographyIsLand(mask,{lat:-45,lon:90})).toBe(false);
  });
});
